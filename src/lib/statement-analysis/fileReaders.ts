// ── Stage 1-2: Upload → Detect Format → Extract raw rows/text ──────────────
// Everything here runs client-side in the browser (same pattern already used
// on the /imports page) so there's no server/OCR infrastructure to host or
// pay for. Large PDFs + OCR can take a while, so every entry point accepts
// an `onProgress` callback.

import * as XLSX from "xlsx";
import Papa from "papaparse";
import type { FileKind, RawParsedRow, PositionedToken } from "./types";
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
export function parseCsv(file: File): Promise<{ rows: RawParsedRow[]; metaLines: string[] }> {
  return new Promise((resolve, reject) => {
    Papa.parse<string[]>(file, {
      header: false,
      skipEmptyLines: "greedy",
      dynamicTyping: false,
      complete: (res) => {
        const { rows, metaLines } = extractRowsFromMatrix(res.data as string[][]);
        resolve({ rows, metaLines });
      },
      error: (err) => reject(err),
    });
  });
}

// ── XLSX / XLS ───────────────────────────────────────────────────────────
export function parseXlsx(file: File): Promise<{ rows: RawParsedRow[]; metaLines: string[] }> {
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
        let bestMeta: string[] = [];
        let bestScore = -1;
        for (const sheetName of workbook.SheetNames) {
          const sheet = workbook.Sheets[sheetName];
          const matrix = XLSX.utils.sheet_to_json<string[]>(sheet, {
            header: 1,
            defval: "",
            raw: false,
          }) as unknown as string[][];
          const { rows, detection, metaLines } = extractRowsFromMatrix(matrix);
          if (!detection) continue;
          if (detection.score > bestScore || (detection.score === bestScore && rows.length > best.length)) {
            bestScore = detection.score;
            best = rows;
            bestMeta = metaLines;
          }
        }
        resolve({ rows: best, metaLines: bestMeta });
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
  /** Word-level positions per page, top-down (smaller y = higher up the page). Empty page arrays are kept for index alignment. */
  tokensByPage: PositionedToken[][];
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
  const tokensByPage: PositionedToken[][] = [];
  let totalChars = 0;

  for (let i = 1; i <= pageCount; i++) {
    onProgress?.(`Reading page ${i} of ${pageCount}`, (i / pageCount) * 40);
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageTokens: PositionedToken[] = [];

    // Group text items into lines by their Y position (for the plain-text
    // view used by fallback parsing + metadata sniffing) while separately
    // keeping every word's exact position (for column reconstruction).
    const rowsByY = new Map<number, { x: number; str: string }[]>();
    for (const item of content.items as { str: string; transform: number[]; width?: number; height?: number }[]) {
      if (!("str" in item) || !item.str.trim()) continue;
      const y = Math.round(item.transform[5]);
      const x = item.transform[4];
      if (!rowsByY.has(y)) rowsByY.set(y, []);
      rowsByY.get(y)!.push({ x, str: item.str });

      // PDF space is bottom-up (larger y = higher on the page) — negate so
      // smaller values are consistently "further up the page" like every
      // other coordinate source (canvas/OCR) feeding into pdfTable.ts.
      const fontHeight = Math.abs(item.transform[3]) || 10;
      pageTokens.push({
        text: item.str,
        x,
        y: -item.transform[5],
        width: item.width ?? item.str.length * fontHeight * 0.5,
        height: fontHeight,
        page: i,
        confidence: 100,
      });
    }
    tokensByPage.push(pageTokens);

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
    return { isScanned: false, pageCount, lines, tokensByPage };
  }

  // ── OCR fallback for scanned / image-based PDFs ──────────────────────
  onProgress?.("No text layer found — running OCR", 40);
  const { lines: ocrLines, tokensByPage: ocrTokens } = await ocrPdf(doc, pageCount, onProgress);
  return { isScanned: true, pageCount, lines: ocrLines, tokensByPage: ocrTokens };
}

// ── Image preprocessing for OCR ─────────────────────────────────────────
// Scanned bank statements are frequently low-contrast photocopies/phone
// photos. Converting to grayscale and applying a global (Otsu) threshold to
// binarize the image measurably improves Tesseract's accuracy on this kind
// of document without needing a server-side image library.
function preprocessCanvasForOcr(source: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = source.getContext("2d")!;
  const { width, height } = source;
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const gray = new Uint8ClampedArray(width * height);

  for (let p = 0; p < gray.length; p++) {
    const o = p * 4;
    // Standard luminance-weighted grayscale.
    gray[p] = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
  }

  // Otsu's method: pick the threshold that best separates ink from
  // background based on the image's own brightness histogram.
  const hist = new Array(256).fill(0);
  for (let p = 0; p < gray.length; p++) hist[gray[p]]++;
  const total = gray.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let maxVar = 0;
  let threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar) {
      maxVar = between;
      threshold = t;
    }
  }

  for (let p = 0; p < gray.length; p++) {
    const v = gray[p] > threshold ? 255 : 0;
    const o = p * 4;
    data[o] = data[o + 1] = data[o + 2] = v;
  }
  ctx.putImageData(imageData, 0, 0);
  return source;
}

interface OcrWord {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  confidence: number;
}

async function ocrPdf(
  doc: import("pdfjs-dist").PDFDocumentProxy,
  pageCount: number,
  onProgress?: ProgressFn
): Promise<{ lines: string[]; tokensByPage: PositionedToken[][] }> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");
  const lines: string[] = [];
  const tokensByPage: PositionedToken[][] = [];

  try {
    for (let i = 1; i <= pageCount; i++) {
      onProgress?.(`OCR — scanning page ${i} of ${pageCount}`, 40 + (i / pageCount) * 50);
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: 2.5 }); // higher scale = better OCR accuracy on small statement fonts
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d")!;
      await page.render({ canvasContext: ctx, viewport }).promise;
      preprocessCanvasForOcr(canvas);

      const result = await worker.recognize(canvas, {}, { blocks: true });
      const text = result.data.text;
      text
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .forEach((l) => lines.push(l));

      const pageTokens: PositionedToken[] = [];
      const words = extractWordsFromResult(result.data);
      for (const w of words) {
        if (!w.text.trim()) continue;
        pageTokens.push({
          text: w.text,
          x: w.bbox.x0,
          y: w.bbox.y0, // canvas space is already top-down
          width: Math.max(1, w.bbox.x1 - w.bbox.x0),
          height: Math.max(1, w.bbox.y1 - w.bbox.y0),
          page: i,
          confidence: w.confidence,
        });
      }
      tokensByPage.push(pageTokens);
    }
  } finally {
    await worker.terminate();
  }

  return { lines, tokensByPage };
}

// Tesseract.js v5 nests word boxes under blocks→paragraphs→lines→words when
// `blocks: true` is requested; fall back to a flat `words` array for older
// worker versions rather than assuming one shape.
function extractWordsFromResult(data: unknown): OcrWord[] {
  const words: OcrWord[] = [];
  const d = data as { words?: OcrWord[]; blocks?: unknown[] };
  if (Array.isArray(d.words)) return d.words;
  if (Array.isArray(d.blocks)) {
    for (const block of d.blocks as Record<string, unknown>[]) {
      const paragraphs = (block.paragraphs as Record<string, unknown>[]) || [];
      for (const para of paragraphs) {
        const lines = (para.lines as Record<string, unknown>[]) || [];
        for (const line of lines) {
          const lineWords = (line.words as OcrWord[]) || [];
          words.push(...lineWords);
        }
      }
    }
  }
  return words;
}

// ── Image files (single-page scanned statement as a photo) ─────────────
export async function extractImage(
  file: File,
  onProgress?: ProgressFn
): Promise<{ lines: string[]; tokens: PositionedToken[] }> {
  const { createWorker } = await import("tesseract.js");
  onProgress?.("Preparing image", 10);

  // Route the file through the same grayscale+threshold preprocessing used
  // for scanned PDF pages, rather than handing Tesseract the raw photo.
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  preprocessCanvasForOcr(canvas);

  onProgress?.("Running OCR on image", 25);
  const worker = await createWorker("eng");
  try {
    const result = await worker.recognize(canvas, {}, { blocks: true });
    onProgress?.("OCR complete", 90);
    const lines = result.data.text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const words = extractWordsFromResult(result.data);
    const tokens: PositionedToken[] = words
      .filter((w) => w.text.trim())
      .map((w) => ({
        text: w.text,
        x: w.bbox.x0,
        y: w.bbox.y0,
        width: Math.max(1, w.bbox.x1 - w.bbox.x0),
        height: Math.max(1, w.bbox.y1 - w.bbox.y0),
        page: 1,
        confidence: w.confidence,
      }));
    return { lines, tokens };
  } finally {
    await worker.terminate();
  }
}
