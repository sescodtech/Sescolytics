// ── Coordinate-based table reconstruction for PDF text-layer + OCR tokens ──
// The old approach flattened each page into plain text lines and then
// *guessed* which trailing number was debit/credit/balance by counting how
// many numbers were on the line. That breaks the moment a bank's layout
// doesn't match the assumed order, and it throws away the one piece of
// information a rendered/scanned statement actually gives us for free: the
// X position of every word, which is exactly how spreadsheet-style columns
// are laid out on the page.
//
// This module turns `PositionedToken[]` (per page) into the same
// `string[][]` matrix shape XLSX/CSV files produce, so the *rest* of the
// pipeline (header detection, alias matching, row building) is the exact
// same tested code used for spreadsheets — see tableDetector.ts. Only the
// "how do we get a matrix out of this file" step differs per file type.

import type { PositionedToken } from "./types";
import { scoreHeaderRow, normHeader, ALL_ALIASES } from "./tableDetector";

interface Cell {
  text: string;
  x0: number;
  x1: number;
}

interface Row {
  page: number;
  y: number;
  cells: Cell[]; // word-level cells, not yet bucketed into columns
  avgConfidence: number;
}

// ── Step 1: group tokens into visual rows ───────────────────────────────
function groupIntoRows(tokens: PositionedToken[], page: number): Row[] {
  if (!tokens.length) return [];
  const sorted = [...tokens].sort((a, b) => a.y - b.y);
  const heights = sorted.map((t) => t.height).filter((h) => h > 0);
  const medianHeight = heights.length ? heights.sort((a, b) => a - b)[Math.floor(heights.length / 2)] : 10;
  const tolerance = Math.max(2, medianHeight * 0.55);

  const rows: { y: number; tokens: PositionedToken[] }[] = [];
  for (const tok of sorted) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(tok.y - last.y) <= tolerance) {
      last.tokens.push(tok);
      last.y = (last.y * (last.tokens.length - 1) + tok.y) / last.tokens.length; // running average
    } else {
      rows.push({ y: tok.y, tokens: [tok] });
    }
  }

  return rows.map((r) => rowFromTokens(r.tokens, page));
}

// ── Step 2: merge adjacent word tokens into cells based on horizontal gap ──
function rowFromTokens(tokens: PositionedToken[], page: number): Row {
  const sorted = [...tokens].sort((a, b) => a.x - b.x);
  const widths = sorted.map((t) => t.width / Math.max(1, t.text.length)).filter((w) => w > 0);
  const avgCharWidth = widths.length ? widths.reduce((a, b) => a + b, 0) / widths.length : 5;
  const gapThreshold = Math.max(6, avgCharWidth * 2.2); // wider than a normal space → new cell/column

  const cells: Cell[] = [];
  let confSum = 0;
  let confCount = 0;
  for (const tok of sorted) {
    if (tok.confidence !== undefined) {
      confSum += tok.confidence;
      confCount += 1;
    }
    const last = cells[cells.length - 1];
    if (last && tok.x - last.x1 <= gapThreshold) {
      last.text = `${last.text} ${tok.text}`.trim();
      last.x1 = Math.max(last.x1, tok.x + tok.width);
    } else {
      cells.push({ text: tok.text, x0: tok.x, x1: tok.x + tok.width });
    }
  }

  const avgY = sorted.reduce((s, t) => s + t.y, 0) / sorted.length;
  return { page, y: avgY, cells, avgConfidence: confCount ? confSum / confCount : 100 };
}

// ── Step 3: find the header row among the assembled rows ────────────────
function findHeaderRow(rows: Row[], maxScan = 80): { index: number; row: Row } | null {
  let best: { index: number; row: Row; score: number } | null = null;
  const limit = Math.min(rows.length, maxScan);
  for (let i = 0; i < limit; i++) {
    const cellTexts = rows[i].cells.map((c) => c.text);
    const score = scoreHeaderRow(cellTexts);
    // Require at least 3 distinct recognised columns so a single stray
    // "Balance: 10,000" summary line on the cover page isn't mistaken for
    // the real transaction table header.
    if (score >= 3 && (!best || score > best.score)) {
      best = { index: i, row: rows[i], score };
    }
  }
  return best;
}

// ── Step 4: turn the header row's cell positions into column boundaries ──
interface ColumnBound {
  name: string;
  start: number;
  end: number;
}

function buildColumnBounds(headerCells: Cell[]): ColumnBound[] {
  const sorted = [...headerCells].sort((a, b) => a.x0 - b.x0);
  const bounds: ColumnBound[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = i === 0 ? -Infinity : (sorted[i - 1].x1 + sorted[i].x0) / 2;
    const end = i === sorted.length - 1 ? Infinity : (sorted[i].x1 + sorted[i + 1].x0) / 2;
    bounds.push({ name: sorted[i].text, start, end });
  }
  return bounds;
}

// ── Step 5: bucket a data row's cells into the header's columns ─────────
function assignRowToColumns(row: Row, bounds: ColumnBound[]): { cells: string[]; confidence: number } {
  const out = new Array(bounds.length).fill("");
  for (const cell of row.cells) {
    const mid = (cell.x0 + cell.x1) / 2;
    let colIdx = bounds.findIndex((b) => mid >= b.start && mid < b.end);
    if (colIdx === -1) {
      // Falls outside every bound (e.g. narration overflowing past the last
      // column on a narrow layout) — clamp to the nearest column instead of
      // silently dropping the text.
      colIdx = mid < bounds[0]?.start ? 0 : bounds.length - 1;
    }
    out[colIdx] = out[colIdx] ? `${out[colIdx]} ${cell.text}` : cell.text;
  }
  return { cells: out, confidence: row.avgConfidence };
}

export interface BuiltMatrix {
  headers: string[];
  rows: string[][];
  rowConfidences: number[];
}

/**
 * Reconstruct a spreadsheet-style matrix from positioned tokens spanning one
 * or more pages. Returns null when no row scores confidently enough as a
 * real column header — callers should fall back to line-based parsing
 * rather than force a column mapping onto a layout we can't actually read.
 */
export function buildMatrixFromTokens(tokensByPage: PositionedToken[][]): BuiltMatrix | null {
  const allRows: Row[] = [];
  tokensByPage.forEach((tokens, idx) => {
    allRows.push(...groupIntoRows(tokens, idx + 1));
  });
  if (!allRows.length) return null;

  const header = findHeaderRow(allRows);
  if (!header) return null;

  const bounds = buildColumnBounds(header.row.cells);
  if (bounds.length < 2) return null; // need at least e.g. date + amount

  const headers = bounds.map((b) => b.name);
  const dataRows = allRows.slice(header.index + 1);

  const rows: string[][] = [];
  const rowConfidences: number[] = [];
  for (const row of dataRows) {
    if (!row.cells.length) continue;
    const { cells, confidence } = assignRowToColumns(row, bounds);
    if (cells.every((c) => !c.trim())) continue;
    rows.push(cells);
    rowConfidences.push(confidence);
  }

  return { headers, rows, rowConfidences };
}

/** True if a set of header cell texts looks like it matches known statement columns at all. */
export function looksLikeHeaderText(cells: string[]): boolean {
  return cells.some((c) => {
    const nh = normHeader(c);
    return ALL_ALIASES.some((a) => nh === a || nh.includes(a));
  });
}
