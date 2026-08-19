// ── Stage 1-2: Upload → Detect Format → Extract raw rows/text ──────────────
// Everything here runs client-side in the browser (same pattern already used
// on the /imports page) so there's no server/OCR infrastructure to host or
// pay for. Large PDFs + OCR can take a while, so every entry point accepts
// an `onProgress` callback.

import * as XLSX from "xlsx";
import Papa from "papaparse";
import type { FileKind, RawParsedRow } from "./types";
import { extractRowsFromMatrix } from "./tableDetector";

export type ProgressFn = (message: string, pct?: number) => void;

export function detectFileKind(file: File): FileKind | null {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  if (name.endsWith(".csv") || type === "text/csv") return "csv";
  if (name.endsWith(".xlsx") || name.endsWith(".xls") || type.includes("spreadsheet")) return "xlsx";
  if (name.endsWith(".pdf") || type === "application/pdf") return "pdf_text"; // refined after inspection
  if (/\.(png|jpe?g|webp|tiff?)$/.test(name) || type.startsWith("image/")) return "image";
  return null;
}

// ── CSV ──────────────────────────────────────────────────────────────────
// Read headerless so we can scan for the real header row ourselves — some
// exports have a blank spacer row or metadata above the transaction table.
export function parseCsv(file: File): Promise<RawParsedRow[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<string[]>(file, {
      header: false,
      skipEmptyLines: "greedy",
      dynamicTyping: false,
      complete: (res) => {
        const { rows } = extractRowsFromMatrix(res.data as string[][]);
        resolve(rows);
      },
      error: (err) => reject(err),
    });
  });
}

// ── XLSX / XLS ───────────────────────────────────────────────────────────
export function parseXlsx(file: File): Promise<RawParsedRow[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: "array", cellDates: false, raw: true });
        // Some banks export multiple sheets (summary + transactions) — try
        // each sheet's own header scan and keep whichever is most confident
        // (highest header match score, then most rows as a tie-breaker).
        let best: RawParsedRow[] = [];
        let bestScore = -1;
        for (const sheetName of workbook.SheetNames) {
          const sheet = workbook.Sheets[sheetName];
          const matrix = XLSX.utils.sheet_to_json<string[]>(sheet, {
            header: 1,
            defval: "",
            raw: false,
          }) as unknown as string[][];
          const { rows, detection } = extractRowsFromMatrix(matrix);
          if (!detection) continue;
          if (detection.score > bestScore || (detection.score === bestScore && rows.length > best.length)) {
            bestScore = detection.score;
            best = rows;
          }
        }
        resolve(best);
      } catch (err) {
        reject(err);
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

// ── PDF (text layer + scanned/OCR fallback) ─────────────────────────────
export interface PdfExtraction {
  isScanned: boolean;
  pageCount: number;
  lines: string[];
}

async function getPdfJs() {
  const pdfjs = await import("pdfjs-dist");
  // Worker served from CDN matching the installed version — avoids bundling
  // the worker file separately for a Next.js client build.
  pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;
  return pdfjs;
}

export async function extractPdf(file: File, onProgress?: ProgressFn): Promise<PdfExtraction> {
  const pdfjs = await getPdfJs();
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const pageCount = doc.numPages;
  const lines: string[] = [];
  let totalChars = 0;

  for (let i = 1; i <= pageCount; i++) {
    onProgress?.(`Reading page ${i} of ${pageCount}`, (i / pageCount) * 40);
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // Group text items into lines by their Y position.
    const rowsByY = new Map<number, { x: number; str: string }[]>();
    for (const item of content.items as { str: string; transform: number[] }[]) {
      if (!("str" in item)) continue;
      const y = Math.round(item.transform[5]);
      const x = item.transform[4];
      if (!rowsByY.has(y)) rowsByY.set(y, []);
      rowsByY.get(y)!.push({ x, str: item.str });
    }
    const sortedY = Array.from(rowsByY.keys()).sort((a, b) => b - a);
    for (const y of sortedY) {
      const lineText = rowsByY
        .get(y)!
        .sort((a, b) => a.x - b.x)
        .map((t) => t.str)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (lineText) lines.push(lineText);
      totalChars += lineText.length;
    }
  }

  // Heuristic: a real text-layer PDF will have a healthy amount of text per
  // page. Scanned statements come back with ~0 characters (no text layer).
  const avgCharsPerPage = totalChars / Math.max(1, pageCount);
  const isScanned = avgCharsPerPage < 20;

  if (!isScanned) {
    return { isScanned: false, pageCount, lines };
  }

  // ── OCR fallback for scanned / image-based PDFs ──────────────────────
  onProgress?.("No text layer found — running OCR", 40);
  const ocrLines = await ocrPdf(doc, pageCount, onProgress);
  return { isScanned: true, pageCount, lines: ocrLines };
}

async function ocrPdf(
  doc: import("pdfjs-dist").PDFDocumentProxy,
  pageCount: number,
  onProgress?: ProgressFn
): Promise<string[]> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");
  const lines: string[] = [];

  try {
    for (let i = 1; i <= pageCount; i++) {
      onProgress?.(`OCR — scanning page ${i} of ${pageCount}`, 40 + (i / pageCount) * 50);
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: 2.2 }); // higher scale = better OCR accuracy
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d")!;
      await page.render({ canvasContext: ctx, viewport }).promise;

      const {
        data: { text },
      } = await worker.recognize(canvas);
      text
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .forEach((l) => lines.push(l));
    }
  } finally {
    await worker.terminate();
  }

  return lines;
}

// ── Image files (single-page scanned statement as a photo) ─────────────
export async function extractImage(file: File, onProgress?: ProgressFn): Promise<string[]> {
  const { createWorker } = await import("tesseract.js");
  onProgress?.("Running OCR on image", 20);
  const worker = await createWorker("eng");
  try {
    const {
      data: { text },
    } = await worker.recognize(file);
    onProgress?.("OCR complete", 90);
    return text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  } finally {
    await worker.terminate();
  }
}
