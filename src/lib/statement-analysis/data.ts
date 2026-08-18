// ── Data access for statement_uploads / statement_transactions ─────────────
// These two tables were added by schema_statement_analysis.sql and are not
// part of the generated `Database` type in src/lib/supabase/types.ts (that
// file is codegen output for the original schema). Rather than hand-editing
// a generated file, this module owns the typed access layer for the new
// tables — regenerate `types.ts` later and this file can be simplified.

import { supabase } from "@/lib/supabase/client";
import type {
  StatementUploadRow,
  StatementTransactionRow,
  NormalizedTransaction,
  StatementReport,
  UploadStatus,
  FileKind,
} from "./types";

// The two tables below aren't in the generated Database type, so we access
// them through an untyped client handle and rely on this module's own
// function signatures for type safety at the call sites.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
const uploads = () => db.from("statement_uploads");
const txns = () => db.from("statement_transactions");

export async function createUploadRecord(input: {
  filename: string;
  fileKind: FileKind;
  applicantName?: string;
  customerId?: string | null;
  storagePath?: string | null;
  fileSizeBytes?: number;
}): Promise<StatementUploadRow> {
  const { data: userData } = await supabase.auth.getUser();
  const { data, error } = await uploads()
    .insert({
      filename: input.filename,
      file_kind: input.fileKind,
      applicant_name: input.applicantName || null,
      customer_id: input.customerId || null,
      storage_path: input.storagePath || null,
      file_size_bytes: input.fileSizeBytes ?? null,
      status: "processing",
      uploaded_by: userData?.user?.id ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as StatementUploadRow;
}

export async function updateUploadRecord(id: string, patch: Partial<StatementUploadRow>) {
  const { error } = await uploads().update(patch).eq("id", id);
  if (error) throw error;
}

export async function finalizeUpload(params: {
  id: string;
  bankName?: string;
  accountName?: string;
  accountNumber?: string;
  statementStart: string | null;
  statementEnd: string | null;
  status: UploadStatus;
  extractionMethod: string;
  totalTransactions: number;
  flaggedTransactions: number;
  duplicateTransactions: number;
  report: StatementReport;
  errorMessage?: string | null;
}) {
  await updateUploadRecord(params.id, {
    bank_name: params.bankName || null,
    account_name: params.accountName || null,
    account_number: params.accountNumber || null,
    statement_start: params.statementStart,
    statement_end: params.statementEnd,
    status: params.status,
    extraction_method: params.extractionMethod,
    total_transactions: params.totalTransactions,
    flagged_transactions: params.flaggedTransactions,
    duplicate_transactions: params.duplicateTransactions,
    report: params.report,
    error_message: params.errorMessage ?? null,
  } as Partial<StatementUploadRow>);
}

export async function insertTransactions(uploadId: string, transactions: NormalizedTransaction[]) {
  if (!transactions.length) return;
  const rows = transactions.map((t) => ({
    upload_id: uploadId,
    txn_date: t.date,
    narration: t.narration,
    debit: t.debit,
    credit: t.credit,
    balance: t.balance,
    direction: t.direction,
    category: t.category,
    confidence: t.confidence,
    needs_review: t.needsReview,
    review_reason: t.reviewReason || null,
    dedupe_hash: t.dedupeHash,
    is_duplicate: t.isDuplicate,
    raw: t.raw,
    source_row: t.sourceRow ?? null,
  }));

  // Insert in chunks to stay well under request size limits for large statements.
  const CHUNK = 400;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await txns().upsert(chunk, { onConflict: "upload_id,dedupe_hash", ignoreDuplicates: true });
    if (error) throw error;
  }
}

export async function listUploads(): Promise<StatementUploadRow[]> {
  const { data, error } = await uploads().select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []) as StatementUploadRow[];
}

export async function getUpload(id: string): Promise<StatementUploadRow | null> {
  const { data, error } = await uploads().select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data as StatementUploadRow | null;
}

export async function listTransactions(uploadId: string): Promise<StatementTransactionRow[]> {
  const { data, error } = await txns()
    .select("*")
    .eq("upload_id", uploadId)
    .order("txn_date", { ascending: true });
  if (error) throw error;
  return (data || []) as StatementTransactionRow[];
}

export async function updateTransaction(id: string, patch: Partial<StatementTransactionRow>) {
  const { error } = await txns().update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteUpload(id: string) {
  const { error } = await uploads().delete().eq("id", id);
  if (error) throw error;
}

export async function uploadStatementFile(file: File, uploadId: string): Promise<string | null> {
  const path = `${uploadId}/${file.name}`;
  const { error } = await supabase.storage.from("statement-files").upload(path, file, { upsert: true });
  if (error) {
    // Storage bucket may not be provisioned yet — don't block the pipeline on this.
    console.warn("Could not store original statement file:", error.message);
    return null;
  }
  return path;
}

export async function getStatementFileUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from("statement-files").createSignedUrl(path, 60 * 10);
  if (error) return null;
  return data.signedUrl;
}
