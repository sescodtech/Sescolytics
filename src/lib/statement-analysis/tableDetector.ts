// ── Stage 2: bank-agnostic column/row detection ─────────────────────────
// Different banks ship wildly different column names and PDF layouts.
// Rather than hard-coding one bank's format, we match against a broad
// alias list (same "fuzzy column" idea already used on /imports) and, for
// PDFs/OCR text with no columns at all, fall back to a line-pattern scan.

import type { RawParsedRow } from "./types";

// ── CSV / XLSX header aliases ───────────────────────────────────────────
export const FIELD_ALIASES = {
  date: ["date", "transaction date", "txn date", "value date", "posting date", "trans date", "post date"],
  narration: [
    "narration", "description", "remarks", "particulars", "transaction details",
    "details", "memo", "reference", "narrative", "transaction remarks",
  ],
  debit: ["debit", "debit amount", "withdrawal", "withdrawal amount", "money out", "dr", "amount debited", "paid out"],
  credit: ["credit", "credit amount", "deposit", "deposit amount", "money in", "cr", "amount credited", "paid in"],
  amount: ["amount", "transaction amount", "value"],
  type: ["type", "transaction type", "txn type", "dr/cr", "cr/dr", "indicator"],
  balance: ["balance", "running balance", "closing balance", "available balance", "ledger balance"],
} as const;

function normHeader(h: string): string {
  return h.toLowerCase().trim().replace(/[_\-]+/g, " ").replace(/\s+/g, " ");
}

export interface ColumnMapping {
  date?: string;
  narration?: string;
  debit?: string;
  credit?: string;
  amount?: string;
  type?: string;
  balance?: string;
}

/** Inspect the header keys of parsed rows and map them to canonical fields. */
export function detectColumnMapping(rows: RawParsedRow[]): ColumnMapping {
  if (!rows.length) return {};
  const headers = Object.keys(rows[0]);
  const mapping: ColumnMapping = {};

  for (const [field, aliasesRaw] of Object.entries(FIELD_ALIASES)) {
    const aliases = aliasesRaw as readonly string[];
    const match = headers.find((h) => aliases.includes(normHeader(h)));
    if (match) (mapping as Record<string, string>)[field] = match;
  }

  // Loose fallback: partial contains-match for anything still missing.
  for (const [field, aliasesRaw] of Object.entries(FIELD_ALIASES)) {
    if ((mapping as Record<string, string>)[field]) continue;
    const aliases = aliasesRaw as readonly string[];
    const match = headers.find((h) => {
      const nh = normHeader(h);
      return aliases.some((a) => nh.includes(a) || a.includes(nh));
    });
    if (match) (mapping as Record<string, string>)[field] = match;
  }

  return mapping;
}

// ── Header-row scanning ──────────────────────────────────────────────────
// Real-world exports rarely start with the transaction header on row 1:
// some have a blank spacer row first, others have 10-20 rows of bank
// letterhead / account summary above the real table. Instead of assuming
// row 1 is the header, scan the first N rows for whichever one actually
// looks like a transaction header (matches the most known field aliases),
// and treat that as the header row — everything above it is ignored.

const ALL_ALIASES: string[] = Object.values(FIELD_ALIASES).flat() as string[];

function scoreHeaderRow(cells: string[]): number {
  let score = 0;
  for (const cell of cells) {
    const nh = normHeader(String(cell ?? ""));
    if (!nh) continue;
    if (ALL_ALIASES.some((a) => nh === a || nh.includes(a) || a.includes(nh))) score += 1;
  }
  return score;
}

export interface HeaderDetection {
  headerRowIndex: number; // index within the raw matrix
  headers: string[];
  score: number;
}

/** Scan the first `maxScan` rows of a raw (headerless) matrix for the real header row. */
export function findHeaderRow(matrix: string[][], maxScan = 60): HeaderDetection | null {
  let best: HeaderDetection | null = null;
  const limit = Math.min(matrix.length, maxScan);
  for (let i = 0; i < limit; i++) {
    const row = (matrix[i] || []).map((c) => String(c ?? ""));
    const score = scoreHeaderRow(row);
    // Require at least a date-like column plus one amount-like column so a
    // stray row that happens to contain the word "balance" isn't mistaken
    // for the header (e.g. "Closing Balance: 10,000.00" in a summary block).
    if (score >= 2 && (!best || score > best.score)) {
      best = { headerRowIndex: i, headers: row.map((c) => c.trim()), score };
    }
  }
  return best;
}

/** Turn a raw matrix + a known header row into normal {header: value} row objects. */
export function matrixToRows(matrix: string[][], headerRowIndex: number, headers: string[]): RawParsedRow[] {
  const seen = new Map<string, number>();
  const keys = headers.map((h, idx) => {
    const base = h || `Column ${idx + 1}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base} (${count + 1})`;
  });

  const rows: RawParsedRow[] = [];
  for (let r = headerRowIndex + 1; r < matrix.length; r++) {
    const rowArr = matrix[r] || [];
    if (rowArr.every((c) => String(c ?? "").trim() === "")) continue; // skip blank spacer rows
    const obj: RawParsedRow = {};
    keys.forEach((k, idx) => {
      obj[k] = String(rowArr[idx] ?? "").trim();
    });
    rows.push(obj);
  }
  return rows;
}

/** Convenience: raw matrix in, normal rows out, using whichever row scores best as the header. */
/** Convenience: raw matrix in, normal rows out, using whichever row scores best as the header.
 *  Also returns the lines *above* the header row (bank letterhead, account
 *  summary box, etc.) so callers can still guess bank/account metadata from
 *  a sheet where the real transaction header isn't row 1. */
export function extractRowsFromMatrix(matrix: string[][]): {
  rows: RawParsedRow[];
  detection: HeaderDetection | null;
  metaLines: string[];
} {
  const detection = findHeaderRow(matrix);
  if (!detection) return { rows: [], detection: null, metaLines: matrix.slice(0, 40).map((r) => (r || []).join(" ")) };
  const metaLines = matrix
    .slice(0, detection.headerRowIndex)
    .map((r) => (r || []).filter((c) => String(c ?? "").trim()).join(" "))
    .filter(Boolean);
  return { rows: matrixToRows(matrix, detection.headerRowIndex, detection.headers), detection, metaLines };
}

// ── PDF / OCR line-based extraction ─────────────────────────────────────
// Statement lines commonly look like one of:
//   12/01/2026  POS PURCHASE-SHOPRITE LAGOS          5,000.00        120,450.00
//   2026-01-12  Transfer to JOHN DOE via mobile app  25,000.00  Cr   145,450.00
//   12-Jan-2026 SALARY PAYMENT COMPANY LTD                          20,000.00 Cr  100,000.00
// We look for a leading date and 1-3 trailing numbers, and treat everything
// between them as the narration.

const DATE_PATTERNS: { re: RegExp; parse: (m: RegExpMatchArray) => string | null }[] = [
  { re: /^(\d{1,2})\/(\d{1,2})\/(\d{4})/, parse: (m) => toIso(m[3], m[2], m[1]) },
  { re: /^(\d{4})-(\d{1,2})-(\d{1,2})/, parse: (m) => toIso(m[1], m[2], m[3]) },
  { re: /^(\d{1,2})-(\d{1,2})-(\d{4})/, parse: (m) => toIso(m[3], m[2], m[1]) },
  {
    re: /^(\d{1,2})[- ](Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[- ](\d{4})/i,
    parse: (m) => toIso(m[3], String(monthNum(m[2])), m[1]),
  },
];

function monthNum(name: string): number {
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  return months.indexOf(name.slice(0, 3).toLowerCase()) + 1;
}

function toIso(y: string, m: string, d: string): string | null {
  const yy = parseInt(y, 10);
  const mm = parseInt(m, 10);
  const dd = parseInt(d, 10);
  if (!yy || !mm || !dd || mm > 12 || dd > 31) return null;
  return `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

// Amount token: 1,234.56 or 1234.56 or (1,234.56) for negatives
const AMOUNT_RE = /\(?-?₦?\s?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?\)?/g;

export interface ParsedLine {
  date: string;
  narration: string;
  amounts: number[];
  crDrHint: "cr" | "dr" | null;
  raw: string;
}

export function parseStatementLines(lines: string[]): ParsedLine[] {
  const results: ParsedLine[] = [];

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (!line || line.length < 8) continue;

    let date: string | null = null;
    let rest = line;
    for (const { re, parse } of DATE_PATTERNS) {
      const m = line.match(re);
      if (m) {
        date = parse(m);
        rest = line.slice(m[0].length).trim();
        break;
      }
    }
    if (!date) continue; // no date at start → not a transaction line (header/footer/etc.)

    const amountMatches = rest.match(AMOUNT_RE) || [];
    if (amountMatches.length === 0) continue; // no amounts → not a transaction line

    const amounts = amountMatches
      .map((a) => parseFloat(a.replace(/[₦,()\s]/g, "")))
      .filter((n) => !isNaN(n));

    // Narration = everything before the first amount token.
    const firstAmountIdx = rest.search(AMOUNT_RE);
    const narration = (firstAmountIdx > 0 ? rest.slice(0, firstAmountIdx) : rest).trim();

    let crDrHint: "cr" | "dr" | null = null;
    if (/\bcr\b/i.test(rest)) crDrHint = "cr";
    else if (/\bdr\b/i.test(rest)) crDrHint = "dr";

    results.push({ date, narration: narration || "(no description captured)", amounts, crDrHint, raw: rawLine });
  }

  return results;
}

// ── Bank / account metadata sniffing (best effort) ─────────────────────
// Only ever look at the top-of-document letterhead/account-summary block,
// never the full transaction list — a bank code or counterparty name
// buried in a narration ("TRSF TO FCMB...") would otherwise false-match
// as the issuing bank.
const BANK_NAMES = [
  "Charis Microfinance Bank Limited", "Access Bank", "GTBank", "Guaranty Trust Bank", "Zenith Bank",
  "First Bank", "UBA", "United Bank for Africa", "Fidelity Bank", "Union Bank", "Sterling Bank",
  "Stanbic IBTC", "Wema Bank", "Polaris Bank", "Ecobank", "FCMB", "Keystone Bank", "Unity Bank",
  "Providus Bank", "Jaiz Bank", "Heritage Bank", "Kuda", "Opay", "Moniepoint", "Palmpay",
];

const METADATA_STOPWORDS = [
  "statement", "period", "account", "number", "product", "name", "balance", "opening",
  "closing", "debit", "credit", "currency", "recovery", "fee", "interest", "total",
  "amount", "outstanding", "ngn", "narration", "value", "date", "transaction",
];

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

export function guessStatementMetadata(lines: string[]): {
  bankName?: string;
  accountNumber?: string;
  accountName?: string;
} {
  const out: { bankName?: string; accountNumber?: string; accountName?: string } = {};
  const headerLines = lines.slice(0, 40).filter((l) => l && l.trim());
  const headerText = headerLines.join(" \n ");

  for (const bank of BANK_NAMES) {
    if (new RegExp(bank.replace(/\s+/g, "\\s*"), "i").test(headerText)) {
      out.bankName = bank;
      break;
    }
  }
  // Generic fallback for banks not in the known list: any short top-of-document
  // line that mentions "bank".
  if (!out.bankName) {
    const bankLine = headerLines.find((l) => /\bbank\b/i.test(l) && l.trim().length < 60);
    if (bankLine) out.bankName = titleCase(bankLine.replace(/[^A-Za-z .&-]/g, " ").replace(/\s+/g, " ").trim());
  }

  const acctMatch = headerText.match(/account\s*(?:no\.?|number)?[:\s]*([0-9]{10,})/i);
  if (acctMatch) out.accountNumber = acctMatch[1];

  const labelledName = headerText.match(/account\s*name[:\s]+([A-Za-z .'-]{4,60})/i);
  if (labelledName) {
    out.accountName = labelledName[1].trim();
  } else {
    // Many statements print the customer's name as its own unlabelled line
    // near the top (right after the bank's own letterhead), rather than
    // behind an "Account Name:" label. Look for that pattern: a short,
    // mostly-uppercase, digit-free line that isn't the bank name and isn't
    // one of the statement's own field labels.
    const candidate = headerLines.find((l) => {
      const t = l.trim();
      if (t.length < 4 || t.length > 60) return false;
      if (/\d/.test(t)) return false;
      if (/\bbank\b/i.test(t)) return false;
      if (out.bankName && t.toUpperCase().includes(out.bankName.toUpperCase())) return false;
      const words = t.split(/\s+/).filter(Boolean);
      if (words.length < 2 || words.length > 6) return false;
      const lower = t.toLowerCase();
      if (METADATA_STOPWORDS.some((w) => lower.includes(w))) return false;
      const letters = t.replace(/[^A-Za-z]/g, "");
      if (!letters.length) return false;
      const upperRatio = (t.match(/[A-Z]/g) || []).length / letters.length;
      return upperRatio > 0.8; // matches how these statements print customer names
    });
    if (candidate) out.accountName = candidate.trim();
  }

  return out;
}
