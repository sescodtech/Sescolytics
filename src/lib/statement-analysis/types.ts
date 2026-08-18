// ── Shared types for Bank Statement Analysis + Credit Analysis ──────────────
// Pipeline: Raw Statement → Extracted Transactions → Normalised Transactions
//           → Analysis → Report
// Every stage keeps the previous stage's output intact (see `raw` field on
// NormalizedTransaction) so extraction can always be audited/corrected.

export type FileKind = "csv" | "xlsx" | "pdf_text" | "pdf_scanned" | "image";

export type RawParsedRow = Record<string, string>;

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
