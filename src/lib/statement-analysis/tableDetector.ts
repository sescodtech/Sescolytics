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
const BANK_NAMES = [
  "Access Bank", "GTBank", "Guaranty Trust Bank", "Zenith Bank", "First Bank", "UBA",
  "United Bank for Africa", "Fidelity Bank", "Union Bank", "Sterling Bank", "Stanbic IBTC",
  "Wema Bank", "Polaris Bank", "Ecobank", "FCMB", "Keystone Bank", "Unity Bank",
  "Providus Bank", "Jaiz Bank", "Heritage Bank", "Kuda", "Opay", "Moniepoint", "Palmpay",
];

export function guessStatementMetadata(text: string): {
  bankName?: string;
  accountNumber?: string;
  accountName?: string;
} {
  const out: { bankName?: string; accountNumber?: string; accountName?: string } = {};
  for (const bank of BANK_NAMES) {
    if (new RegExp(bank.replace(/\s+/g, "\\s*"), "i").test(text)) {
      out.bankName = bank;
      break;
    }
  }
  const acctMatch = text.match(/account\s*(?:no\.?|number)?[:\s]*([0-9]{10,})/i);
  if (acctMatch) out.accountNumber = acctMatch[1];
  const nameMatch = text.match(/account\s*name[:\s]*([A-Za-z .'-]{4,60})/i);
  if (nameMatch) out.accountName = nameMatch[1].trim();
  return out;
}
