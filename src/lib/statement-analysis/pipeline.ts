// ── Orchestrates the full pipeline for a single uploaded file ──────────────
// Upload → Detect Format → Extract Transactions → Normalise Data
// (Analyse + Generate Summary happen afterwards via analyzer.ts once the
// caller has a NormalizedTransaction[].)

import type { ExtractionResult, FileKind } from "./types";
import { detectFileKind, parseCsv, parseXlsx, extractPdf, extractImage, type ProgressFn } from "./fileReaders";
import { detectColumnMapping, parseStatementLines, guessStatementMetadata } from "./tableDetector";
import { normalizeMappedRows, normalizeParsedLines } from "./normalizer";

export async function runExtractionPipeline(file: File, onProgress?: ProgressFn): Promise<ExtractionResult> {
  const kind = detectFileKind(file);
  const warnings: string[] = [];

  if (!kind) {
    throw new Error(
      "Unsupported file type. Please upload a PDF, CSV, or Excel (.xlsx/.xls) bank statement."
    );
  }

  onProgress?.("Detecting statement format", 5);

  if (kind === "csv") {
    const rows = await parseCsv(file);
    if (!rows.length) throw new Error("The CSV file appears to be empty.");
    onProgress?.("Mapping columns", 30);
    const mapping = detectColumnMapping(rows);
    ensureMappingUsable(mapping, warnings);
    onProgress?.("Normalising transactions", 60);
    const transactions = await normalizeMappedRows(rows, mapping);
    const metaText = rows.map((r) => Object.values(r).join(" ")).join(" ");
    const meta = guessStatementMetadata(metaText);
    onProgress?.("Done", 100);
    return { transactions, method: "csv", warnings, bankNameGuess: meta.bankName, accountNumberGuess: meta.accountNumber, accountNameGuess: meta.accountName };
  }

  if (kind === "xlsx") {
    const rows = await parseXlsx(file);
    if (!rows.length) throw new Error("The spreadsheet appears to be empty.");
    onProgress?.("Mapping columns", 30);
    const mapping = detectColumnMapping(rows);
    ensureMappingUsable(mapping, warnings);
    onProgress?.("Normalising transactions", 60);
    const transactions = await normalizeMappedRows(rows, mapping);
    const metaText = rows.map((r) => Object.values(r).join(" ")).join(" ");
    const meta = guessStatementMetadata(metaText);
    onProgress?.("Done", 100);
    return { transactions, method: "xlsx", warnings, bankNameGuess: meta.bankName, accountNumberGuess: meta.accountNumber, accountNameGuess: meta.accountName };
  }

  if (kind === "pdf_text") {
    const extraction = await extractPdf(file, onProgress);
    const actualKind: FileKind = extraction.isScanned ? "pdf_scanned" : "pdf_text";
    if (extraction.isScanned) warnings.push("This looks like a scanned/image PDF — text was recovered using OCR, which may be less accurate.");
    onProgress?.("Parsing transaction lines", 92);
    const lines = parseStatementLines(extraction.lines);
    if (!lines.length) {
      warnings.push("Could not confidently detect transaction rows in this PDF. All extracted lines have been flagged for manual review.");
    }
    const transactions = await normalizeParsedLines(lines);
    const meta = guessStatementMetadata(extraction.lines.join(" "));
    onProgress?.("Done", 100);
    return { transactions, method: actualKind, warnings, bankNameGuess: meta.bankName, accountNumberGuess: meta.accountNumber, accountNameGuess: meta.accountName };
  }

  if (kind === "image") {
    const ocrLines = await extractImage(file, onProgress);
    onProgress?.("Parsing transaction lines", 92);
    const lines = parseStatementLines(ocrLines);
    if (!lines.length) {
      warnings.push("Could not confidently detect transaction rows in this image. Try a clearer scan or a PDF/CSV export instead.");
    }
    const transactions = await normalizeParsedLines(lines);
    const meta = guessStatementMetadata(ocrLines.join(" "));
    onProgress?.("Done", 100);
    return { transactions, method: "image", warnings, bankNameGuess: meta.bankName, accountNumberGuess: meta.accountNumber, accountNameGuess: meta.accountName };
  }

  throw new Error("Unsupported file type.");
}

function ensureMappingUsable(mapping: { date?: string; narration?: string; debit?: string; credit?: string; amount?: string }, warnings: string[]) {
  if (!mapping.date) warnings.push("Could not confidently detect a date column — rows without a readable date will be flagged for review.");
  if (!mapping.debit && !mapping.credit && !mapping.amount) {
    throw new Error("Could not detect any amount/debit/credit column in this file. Please check the file has transaction data.");
  }
  if (!mapping.narration) warnings.push("Could not detect a narration/description column — categorisation will be less accurate.");
}
