// ── Stage 3: Normalise Data ─────────────────────────────────────────────
// Converts whatever came out of Stage 2 (mapped CSV/XLSX rows, or parsed
// PDF/OCR lines) into a single NormalizedTransaction[] shape, applying:
//   - date/amount parsing that doesn't assume one fixed layout
//   - inflow/outflow direction resolution
//   - category classification
//   - confidence scoring + review flags for anything uncertain
//   - duplicate detection via a content hash

import * as XLSX from "xlsx";
import type { NormalizedTransaction, RawParsedRow, Direction } from "./types";
import type { ColumnMapping } from "./tableDetector";
import type { ParsedLine } from "./tableDetector";
import { categorizeTransaction } from "./categorizer";

let seq = 0;
function tempId(): string {
  seq += 1;
  return `t${Date.now()}_${seq}`;
}

function parseDateFlexible(raw: string): string | null {
  if (!raw) return null;
  const v = raw.trim();
  if (!v) return null;

  // Excel serial number
  if (/^\d{4,6}$/.test(v)) {
    try {
      const d = XLSX.SSF.parse_date_code(parseInt(v, 10));
      if (d && d.y) return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
    } catch {
      /* fall through */
    }
  }
  // YYYY-MM-DD (already ISO, possibly with time)
  if (/^\d{4}-\d{1,2}-\d{1,2}/.test(v)) {
    const [y, m, d] = v.slice(0, 10).split("-");
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // DD/MM/YYYY or MM/DD/YYYY — assume DD/MM (Nigerian convention) unless day > 12
  const slashMatch = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slashMatch) {
    let [, a, b, y] = slashMatch;
    let day = parseInt(a, 10);
    let month = parseInt(b, 10);
    if (day > 12 && month <= 12) {
      // fine, a is day
    } else if (month > 12 && day <= 12) {
      [day, month] = [month, day];
    }
    return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  // DD-MM-YYYY
  const dashMatch = v.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);
  if (dashMatch) {
    const [, d, m, y] = dashMatch;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // "12 Jan 2026" / "Jan 12, 2026"
  const monthNameMatch =
    v.match(/^(\d{1,2})[\s-]?([A-Za-z]{3,9})[\s,-]?(\d{4})/) ||
    v.match(/^([A-Za-z]{3,9})[\s-]?(\d{1,2})[,\s]+(\d{4})/);
  if (monthNameMatch) {
    const parsed = new Date(v);
    if (!isNaN(parsed.getTime())) {
      return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(
        parsed.getDate()
      ).padStart(2, "0")}`;
    }
  }
  const generic = new Date(v);
  if (!isNaN(generic.getTime())) {
    return `${generic.getFullYear()}-${String(generic.getMonth() + 1).padStart(2, "0")}-${String(
      generic.getDate()
    ).padStart(2, "0")}`;
  }
  return null;
}

function parseAmount(raw: string | number | undefined): number {
  if (raw === undefined || raw === null) return 0;
  if (typeof raw === "number") return raw;
  const cleaned = raw.replace(/[₦,\s]/g, "").replace(/^\((.+)\)$/, "-$1");
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

async function hash(input: string): Promise<string> {
  try {
    const enc = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest("SHA-1", enc);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    // Fallback (non-secure contexts): simple deterministic string hash.
    let h = 0;
    for (let i = 0; i < input.length; i++) {
      h = (h << 5) - h + input.charCodeAt(i);
      h |= 0;
    }
    return String(h);
  }
}

function buildTransaction(params: {
  date: string | null;
  narration: string;
  debit: number;
  credit: number;
  balance: number | null;
  sourceRow?: number;
  raw: Record<string, unknown>;
  ocrConfidence?: number;
}): Omit<NormalizedTransaction, "dedupeHash" | "isDuplicate"> {
  const { date, narration, debit, credit, balance, sourceRow, raw, ocrConfidence } = params;
  const direction: Direction = credit > debit ? "inflow" : "outflow";
  const amountForCategory = direction === "inflow" ? credit : debit;

  const reasons: string[] = [];
  let confidence = 1;
  if (!date) {
    reasons.push("Could not determine a transaction date");
    confidence -= 0.5;
  }
  if (debit === 0 && credit === 0) {
    reasons.push("No debit or credit amount detected");
    confidence -= 0.4;
  }
  if (!narration || narration.length < 3) {
    reasons.push("Narration/description missing or unreadable");
    confidence -= 0.15;
  }
  if (debit > 0 && credit > 0) {
    reasons.push("Both debit and credit amounts present on the same row — verify manually");
    confidence -= 0.2;
  }
  // OCR word confidence (0-100) for this row's tokens, when the source was a
  // scanned/image statement — low confidence means the digits/text may have
  // been misread even though a value was extracted, so it's flagged rather
  // than silently trusted.
  if (ocrConfidence !== undefined && ocrConfidence < 70) {
    reasons.push(`Low OCR confidence (${Math.round(ocrConfidence)}%) — verify against the original document`);
    confidence -= ocrConfidence < 50 ? 0.35 : 0.2;
  }
  confidence = Math.max(0, Math.min(1, confidence));

  return {
    tempId: tempId(),
    date,
    narration: narration || "(no description captured)",
    debit,
    credit,
    balance,
    direction,
    category: categorizeTransaction(narration, direction),
    confidence: Number(confidence.toFixed(2)),
    needsReview: confidence < 0.75 || amountForCategory === 0,
    reviewReason: reasons.length ? reasons.join("; ") : undefined,
    sourceRow,
    raw,
  };
}

/** Normalise CSV/XLSX rows once columns have been mapped. */
export async function normalizeMappedRows(
  rows: RawParsedRow[],
  mapping: ColumnMapping
): Promise<NormalizedTransaction[]> {
  const out: (Omit<NormalizedTransaction, "dedupeHash" | "isDuplicate"> & { raw: Record<string, unknown> })[] = [];

  rows.forEach((row, idx) => {
    const dateRaw = mapping.date ? row[mapping.date] : "";
    const date = parseDateFlexible(dateRaw || "");
    const narration = mapping.narration ? (row[mapping.narration] || "").trim() : "";

    let debit = mapping.debit ? parseAmount(row[mapping.debit]) : 0;
    let credit = mapping.credit ? parseAmount(row[mapping.credit]) : 0;

    // Single "amount" column + a Dr/Cr indicator column (common in some banks)
    if (!mapping.debit && !mapping.credit && mapping.amount) {
      const amt = parseAmount(row[mapping.amount]);
      const rawAmountCell = (row[mapping.amount] || "").toLowerCase();
      // The Dr/Cr indicator sometimes lives in its own column, but on many
      // PDF/OCR layouts it's suffixed directly onto the amount cell itself
      // (e.g. "5,000.00 DR") with no separate column at all — check both.
      const typeVal = `${mapping.type ? row[mapping.type] : ""} ${rawAmountCell}`.toLowerCase();
      const isDebit = /\bdr\b|debit|withdrawal|\bout\b/.test(typeVal);
      const isCredit = /\bcr\b|credit|deposit|\bin\b/.test(typeVal);
      if (amt < 0 || (isDebit && !isCredit)) debit = Math.abs(amt);
      else if (isCredit && !isDebit) credit = Math.abs(amt);
      else if (amt !== 0) credit = Math.abs(amt); // no reliable indicator either way — default matches prior behaviour
    }

    const balance = mapping.balance ? parseAmount(row[mapping.balance]) : null;
    const ocrConfidenceRaw = row["__ocr_confidence__"];
    const ocrConfidence = ocrConfidenceRaw !== undefined ? parseFloat(ocrConfidenceRaw) : undefined;

    out.push(
      buildTransaction({
        date,
        narration,
        debit,
        credit,
        balance: mapping.balance ? balance : null,
        sourceRow: idx + 2, // +2 = header row + 1-index
        raw: row,
        ocrConfidence: ocrConfidence !== undefined && !isNaN(ocrConfidence) ? ocrConfidence : undefined,
      })
    );
  });

  return finalizeDedup(out);
}

/** Normalise PDF/OCR parsed lines (no column headers — heuristic amount assignment). */
export async function normalizeParsedLines(lines: ParsedLine[]): Promise<NormalizedTransaction[]> {
  const out: (Omit<NormalizedTransaction, "dedupeHash" | "isDuplicate"> & { raw: Record<string, unknown> })[] = [];

  lines.forEach((line, idx) => {
    let debit = 0;
    let credit = 0;
    let balance: number | null = null;

    // Most bank lines end with: [amount] [Dr/Cr]? [balance]
    // Fewer amounts = less certainty about which is which.
    const amounts = line.amounts;
    if (amounts.length === 1) {
      // Only one number — assume it's the transaction amount, use Cr/Dr hint if present.
      if (line.crDrHint === "cr") credit = amounts[0];
      else debit = amounts[0];
    } else if (amounts.length === 2) {
      // amount + balance
      const [amt, bal] = amounts;
      if (line.crDrHint === "cr") credit = amt;
      else debit = amt;
      balance = bal;
    } else if (amounts.length >= 3) {
      // debit, credit, balance (or similar) — last is balance, the larger of
      // the first two (non-zero) is treated as the actual amount.
      balance = amounts[amounts.length - 1];
      const [a, b] = amounts;
      if (a > 0 && b === 0) debit = a;
      else if (b > 0 && a === 0) credit = b;
      else if (line.crDrHint === "cr") credit = Math.max(a, b);
      else debit = Math.max(a, b);
    }

    out.push(
      buildTransaction({
        date: line.date,
        narration: line.narration,
        debit,
        credit,
        balance,
        sourceRow: idx + 1,
        raw: { rawLine: line.raw },
      })
    );
  });

  return finalizeDedup(out);
}

// ── Stage 3b: validate running balances mathematically ──────────────────
// Rather than trusting whichever column got labelled "debit" vs "credit",
// cross-check every row's printed balance against the previous balance +
// this row's movement. A statement's own balance column is ground truth
// wherever it's present, so this both catches genuine extraction errors
// (flag it) and resolves the common case of a swapped debit/credit column
// (auto-correct it, since the arithmetic proves which way it goes).
const BALANCE_EPSILON = 1.0; // naira — allows for rounding / unprinted fees

export function applyRunningBalanceValidation(
  transactions: NormalizedTransaction[],
  openingBalance?: number | null
): NormalizedTransaction[] {
  const out = [...transactions];
  let prevBalance: number | null = openingBalance ?? null;

  for (let i = 0; i < out.length; i++) {
    const t = out[i];
    if (t.isDuplicate) continue; // don't let an excluded duplicate break the chain
    if (t.balance === null) {
      continue; // nothing to check this row against — keep prevBalance as-is
    }
    if (prevBalance === null) {
      prevBalance = t.balance; // seed the chain from the first row that has one
      continue;
    }

    const expected = prevBalance + t.credit - t.debit;
    const expectedSwapped = prevBalance + t.debit - t.credit;
    const diffNormal = Math.abs(expected - t.balance);
    const diffSwapped = Math.abs(expectedSwapped - t.balance);

    if (diffNormal <= BALANCE_EPSILON) {
      // Consistent — nothing to do.
    } else if (diffSwapped <= BALANCE_EPSILON && (t.debit > 0 || t.credit > 0)) {
      const swapped: NormalizedTransaction = {
        ...t,
        debit: t.credit,
        credit: t.debit,
        direction: t.debit > t.credit ? "inflow" : "outflow", // post-swap values
      };
      swapped.direction = swapped.credit > swapped.debit ? "inflow" : "outflow";
      swapped.category = categorizeTransaction(swapped.narration, swapped.direction);
      swapped.reviewReason = [swapped.reviewReason, "Debit/credit were swapped — corrected using the statement's running balance"]
        .filter(Boolean)
        .join("; ");
      out[i] = swapped;
    } else {
      out[i] = {
        ...t,
        needsReview: true,
        confidence: Math.min(t.confidence, 0.5),
        reviewReason: [
          t.reviewReason,
          `Running balance mismatch — expected ~${expected.toFixed(2)} from the previous balance, statement shows ${t.balance.toFixed(2)}`,
        ]
          .filter(Boolean)
          .join("; "),
      };
    }

    prevBalance = out[i].balance;
  }

  return out;
}

async function finalizeDedup(
  items: (Omit<NormalizedTransaction, "dedupeHash" | "isDuplicate"> & { raw: Record<string, unknown> })[]
): Promise<NormalizedTransaction[]> {
  const seen = new Set<string>();
  const result: NormalizedTransaction[] = [];

  for (const item of items) {
    const key = `${item.date}|${item.narration.toLowerCase().trim()}|${item.debit}|${item.credit}|${item.balance ?? ""}`;
    const dedupeHash = await hash(key);
    const isDuplicate = seen.has(dedupeHash);
    seen.add(dedupeHash);
    result.push({ ...item, dedupeHash, isDuplicate, needsReview: item.needsReview || isDuplicate });
  }

  return result;
}
