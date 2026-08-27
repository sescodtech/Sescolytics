// ── Orchestrates the full pipeline for a single uploaded file ──────────────
// Upload → Detect Format → Extract Transactions → Normalise Data
// (Analyse + Generate Summary happen afterwards via analyzer.ts once the
// caller has a NormalizedTransaction[].)

import type { ExtractionResult, FileKind, NormalizedTransaction, PositionedToken, RawParsedRow } from "./types";
import { detectFileKind, parseCsv, parseXlsx, extractPdf, extractImage, type ProgressFn } from "./fileReaders";
import {
  detectColumnMapping,
  parseStatementLines,
  guessStatementMetadata,
  mergeContinuationRows,
  stripNoiseRows,
  detectOpeningClosingBalance,
  matrixToRows,
  type ColumnMapping,
} from "./tableDetector";
import { buildMatrixFromTokens } from "./pdfTable";
import { normalizeMappedRows, normalizeParsedLines, applyRunningBalanceValidation } from "./normalizer";

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
    const { rows, metaLines } = await parseCsv(file);
    if (!rows.length) throw new Error("The CSV file appears to be empty.");
    onProgress?.("Mapping columns", 30);
    const mapping = detectColumnMapping(rows);
    ensureMappingUsable(mapping, warnings);
    onProgress?.("Normalising transactions", 60);
    const transactions = await normalizeMappedRows(rows, mapping);
    const meta = guessStatementMetadata(metaLines.length ? metaLines : rows.slice(0, 5).map((r) => Object.values(r).join(" ")));
    onProgress?.("Done", 100);
    return { transactions, method: "csv", warnings, accountNumberGuess: meta.accountNumber, accountNameGuess: meta.accountName };
  }

  if (kind === "xlsx") {
    const { rows, metaLines } = await parseXlsx(file);
    if (!rows.length) throw new Error("The spreadsheet appears to be empty.");
    onProgress?.("Mapping columns", 30);
    const mapping = detectColumnMapping(rows);
    ensureMappingUsable(mapping, warnings);
    onProgress?.("Normalising transactions", 60);
    const transactions = await normalizeMappedRows(rows, mapping);
    const meta = guessStatementMetadata(metaLines.length ? metaLines : rows.slice(0, 5).map((r) => Object.values(r).join(" ")));
    onProgress?.("Done", 100);
    return { transactions, method: "xlsx", warnings, accountNumberGuess: meta.accountNumber, accountNameGuess: meta.accountName };
  }

  if (kind === "pdf_text") {
    const extraction = await extractPdf(file, onProgress);
    const actualKind: FileKind = extraction.isScanned ? "pdf_scanned" : "pdf_text";
    if (extraction.isScanned) warnings.push("This looks like a scanned/image PDF — text was recovered using OCR, which may be less accurate.");
    onProgress?.("Mapping columns", 55);
    const result = await extractFromPositionedLayout({
      tokensByPage: extraction.tokensByPage,
      lines: extraction.lines,
      isScanned: extraction.isScanned,
    });
    warnings.push(...result.warnings);
    const meta = guessStatementMetadata(extraction.lines);
    onProgress?.("Done", 100);
    return {
      transactions: result.transactions,
      method: actualKind,
      warnings,
      accountNumberGuess: meta.accountNumber,
      accountNameGuess: meta.accountName,
      openingBalanceGuess: result.opening,
      closingBalanceGuess: result.closing,
      columnLayoutDetected: result.columnLayoutDetected,
    };
  }

  if (kind === "image") {
    const { lines: ocrLines, tokens } = await extractImage(file, onProgress);
    onProgress?.("Mapping columns", 55);
    const result = await extractFromPositionedLayout({
      tokensByPage: [tokens],
      lines: ocrLines,
      isScanned: true,
    });
    if (!result.transactions.length) {
      warnings.push("Could not confidently detect transaction rows in this image. Try a clearer scan or a PDF/CSV export instead.");
    }
    warnings.push(...result.warnings);
    const meta = guessStatementMetadata(ocrLines);
    onProgress?.("Done", 100);
    return {
      transactions: result.transactions,
      method: "image",
      warnings,
      accountNumberGuess: meta.accountNumber,
      accountNameGuess: meta.accountName,
      openingBalanceGuess: result.opening,
      closingBalanceGuess: result.closing,
      columnLayoutDetected: result.columnLayoutDetected,
    };
  }

  throw new Error("Unsupported file type.");
}

// ── Shared PDF/image extraction: column-based first, line-scan fallback ──
// Both a real PDF page and an OCR'd scan ultimately give us the same thing
// (word tokens with positions), so text-layer PDFs, scanned PDFs, and plain
// image uploads all go through this one path. Column positions from the
// statement's own layout are used to map debit/credit/balance whenever a
// header row can be found with reasonable confidence; only when that fails
// do we drop back to the old "date + trailing numbers" line scan.
async function extractFromPositionedLayout(params: {
  tokensByPage: PositionedToken[][];
  lines: string[];
  isScanned: boolean;
}): Promise<{
  transactions: NormalizedTransaction[];
  warnings: string[];
  opening: number | null;
  closing: number | null;
  columnLayoutDetected: boolean;
}> {
  const warnings: string[] = [];
  const built = buildMatrixFromTokens(params.tokensByPage);

  let mapping: ColumnMapping | null = null;
  let rows: RawParsedRow[] = [];

  if (built && built.rows.length) {
    try {
      let candidateRows = matrixToRows([built.headers, ...built.rows], 0, built.headers);
      if (params.isScanned) {
        candidateRows = candidateRows.map((row, idx) => ({
          ...row,
          __ocr_confidence__: String(built.rowConfidences[idx] ?? 100),
        }));
      }
      const candidateMapping = detectColumnMapping(candidateRows);
      const mappingWarnings: string[] = [];
      ensureMappingUsable(candidateMapping, mappingWarnings); // throws if no usable amount/debit/credit column
      // Strip footer/page-number/repeated-header noise BEFORE merging
      // continuation lines — otherwise a stray "Page 2 of 2" line with no
      // date/amount of its own would be folded straight into the previous
      // transaction's narration instead of being discarded.
      candidateRows = stripNoiseRows(candidateRows, built.headers);
      candidateRows = mergeContinuationRows(candidateRows, candidateMapping);
      if (candidateRows.length) {
        mapping = candidateMapping;
        rows = candidateRows;
        warnings.push(...mappingWarnings);
      }
    } catch {
      // Column layout wasn't usable (e.g. no recognisable amount column) — fall through to the line scan below.
    }
  }

  let transactions: NormalizedTransaction[];
  const columnLayoutDetected = !!(mapping && rows.length);

  if (columnLayoutDetected && mapping) {
    transactions = await normalizeMappedRows(rows, mapping);
  } else {
    warnings.push(
      built
        ? "Found a table on the page but couldn't confidently map its columns — falling back to line-by-line extraction. Please review the results carefully."
        : "Could not detect a clear column layout in this document — falling back to line-by-line extraction. Please review the results carefully."
    );
    const parsedLines = parseStatementLines(params.lines);
    if (!parsedLines.length) {
      warnings.push("Could not confidently detect transaction rows in this document. All extracted lines have been flagged for manual review.");
    }
    transactions = await normalizeParsedLines(parsedLines);
  }

  const { opening, closing } = detectOpeningClosingBalance(params.lines);
  transactions = applyRunningBalanceValidation(transactions, opening);

  if (closing !== null) {
    const lastWithBalance = [...transactions].reverse().find((t) => t.balance !== null);
    if (lastWithBalance && Math.abs((lastWithBalance.balance as number) - closing) > 1) {
      warnings.push(
        `The statement's closing balance (${closing.toLocaleString()}) doesn't match the last extracted transaction's balance (${(
          lastWithBalance.balance as number
        ).toLocaleString()}) — some rows may be missing or misread.`
      );
    }
  }

  return { transactions, warnings, opening, closing, columnLayoutDetected };
}

function ensureMappingUsable(mapping: { date?: string; narration?: string; debit?: string; credit?: string; amount?: string }, warnings: string[]) {
  if (!mapping.date) warnings.push("Could not confidently detect a date column — rows without a readable date will be flagged for review.");
  if (!mapping.debit && !mapping.credit && !mapping.amount) {
    throw new Error("Could not detect any amount/debit/credit column in this file. Please check the file has transaction data.");
  }
  if (!mapping.narration) warnings.push("Could not detect a narration/description column — categorisation will be less accurate.");
}
