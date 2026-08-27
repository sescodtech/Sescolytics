// ── Shared types for Bank Statement Analysis + Credit Analysis ──────────────
// Pipeline: Raw Statement → Extracted Transactions → Normalised Transactions
//           → Analysis → Report
// Every stage keeps the previous stage's output intact (see `raw` field on
// NormalizedTransaction) so extraction can always be audited/corrected.

export type FileKind = "csv" | "xlsx" | "pdf_text" | "pdf_scanned" | "image";

export type RawParsedRow = Record<string, string>;

// ── Positioned tokens (text-layer PDF words or OCR words) ──────────────────
// A single unit of text with its location on the page, used to reconstruct
// the statement's actual table layout instead of guessing from raw numbers.
// `y` is normalised so that SMALLER values are further up the page (top-down
// reading order) regardless of the source's native coordinate system —
// callers must convert PDF's bottom-up y before constructing these.
export interface PositionedToken {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  page: number; // 1-indexed
  /** 0-100. 100/undefined for text-layer PDF tokens (exact); OCR word confidence otherwise. */
  confidence?: number;
}

export type Direction = "inflow" | "outflow";

export interface NormalizedTransaction {
  /** Stable id used client-side before the row has a DB id */
  tempId: string;
  date: string | null; // YYYY-MM-DD, null if undetectable
  narration: string;
  debit: number;
  credit: number;
  balance: number | null;
  direction: Direction;
  category: string;
  /** 0 - 1, how sure the extractor is about this row */
  confidence: number;
  needsReview: boolean;
  reviewReason?: string;
  dedupeHash: string;
  isDuplicate: boolean;
  sourceRow?: number;
  raw: Record<string, unknown>;
}

export interface ExtractionResult {
  transactions: NormalizedTransaction[];
  method: FileKind;
  bankNameGuess?: string;
  accountNumberGuess?: string;
  accountNameGuess?: string;
  warnings: string[];
  /** Best-effort, from an "Opening Balance"/"Balance B/F" line — used to validate running balances. */
  openingBalanceGuess?: number | null;
  /** Best-effort, from a "Closing Balance"/"Balance C/F" line — cross-checked against the last row. */
  closingBalanceGuess?: number | null;
  /** True when column positions were used to map the table (PDF/OCR); false when the line-scan fallback was used. */
  columnLayoutDetected?: boolean;
}

export interface CategoryBreakdown {
  [category: string]: number;
}

export interface MonthlyBucket {
  monthKey: string; // YYYY-MM
  monthLabel: string; // "January 2026"
  inflow: number;
  outflow: number;
  net: number;
  txnCount: number;
  endingBalance: number | null;
  inflowBreakdown: CategoryBreakdown;
  outflowBreakdown: CategoryBreakdown;
}

export interface RecurringPattern {
  signature: string; // normalised narration used to group these
  sampleNarration: string; // original narration text, for display
  direction: Direction;
  category: string;
  avgAmount: number;
  minAmount: number;
  maxAmount: number;
  occurrences: number;
  monthsSeen: string[]; // YYYY-MM
  avgDayOfMonth: number;
  dayOfMonthConsistencyPct: number; // 0-100, higher = lands on same day each time
  amountConsistencyPct: number; // 0-100, higher = same amount each time
  confidencePct: number; // 0-100 overall
  isLikelyIncome: boolean; // heuristic: recurring inflow, monthly-ish cadence
}

export interface CreditAnalysis {
  monthsAnalyzed: number;
  avgMonthlyInflow: number;
  avgMonthlyOutflow: number;
  avgMonthlyNet: number;
  avgBalance: number;
  lowestBalance: number | null;
  highestBalance: number | null;
  existingObligations: number; // avg monthly loan-repayment-like outflow
  incomeConsistencyPct: number; // 0-100, higher = more consistent inflow month to month
  cashflowStabilityPct: number; // 0-100, higher = more months with positive/near-flat net
  positiveMonths: number;
  negativeMonths: number;
  primaryIncome: RecurringPattern | null;
  recurringObligations: RecurringPattern[];
  assessment: "Low" | "Moderate" | "Strong";
  assessmentNotes: string[];
}

export interface StatementReport {
  months: MonthlyBucket[];
  totals: {
    inflow: number;
    outflow: number;
    net: number;
    avgMonthlyInflow: number;
    avgMonthlyOutflow: number;
  };
  credit: CreditAnalysis;
  flaggedCount: number;
  duplicateCount: number;
  totalCount: number;
  generatedAt: string;
}

export type UploadStatus =
  | "uploaded"
  | "processing"
  | "needs_review"
  | "completed"
  | "failed";

export interface StatementUploadRow {
  id: string;
  customer_id: string | null;
  applicant_name: string | null;
  filename: string;
  file_kind: FileKind;
  storage_path: string | null;
  file_size_bytes: number | null;
  bank_name: string | null;
  account_name: string | null;
  account_number: string | null;
  statement_start: string | null;
  statement_end: string | null;
  status: UploadStatus;
  extraction_method: string | null;
  total_transactions: number;
  flagged_transactions: number;
  duplicate_transactions: number;
  error_message: string | null;
  report: StatementReport | null;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface StatementTransactionRow {
  id: string;
  upload_id: string;
  txn_date: string | null;
  narration: string;
  debit: number;
  credit: number;
  balance: number | null;
  direction: Direction | null;
  category: string;
  confidence: number;
  needs_review: boolean;
  review_reason: string | null;
  reviewed: boolean;
  dedupe_hash: string;
  is_duplicate: boolean;
  raw: Record<string, unknown> | null;
  source_row: number | null;
  created_at: string;
}

export interface ProgressStep {
  key: string;
  label: string;
  status: "pending" | "active" | "done" | "error";
  detail?: string;
}
