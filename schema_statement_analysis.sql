-- ============================================================
-- ILRMS — Charis Microfinance Bank
-- UPGRADE: Bank Statement Analysis + Credit Analysis Module
--
-- This is an ADDITIVE migration. It does not touch any existing
-- table. Paste this entire file into the Supabase SQL Editor
-- (after the base schema.sql has already been run) and Run.
-- ============================================================

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE statement_status AS ENUM (
  'uploaded',      -- file received, queued
  'processing',    -- extraction / OCR in progress
  'needs_review',  -- extraction finished but low-confidence rows exist
  'completed',     -- extraction + analysis finished, nothing blocking
  'failed'         -- could not be processed at all
);

CREATE TYPE statement_file_kind AS ENUM (
  'csv', 'xlsx', 'pdf_text', 'pdf_scanned', 'image'
);

CREATE TYPE txn_direction AS ENUM ('inflow', 'outflow');

-- ============================================================
-- STATEMENT UPLOADS
-- One row per uploaded bank statement (the "Raw Statement" +
-- pointer to the generated report).
-- ============================================================

CREATE TABLE statement_uploads (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Optional link to an existing customer record. Nullable because
  -- this tool is also usable for prospective/unregistered applicants.
  customer_id           UUID REFERENCES customers(id) ON DELETE SET NULL,
  applicant_name        TEXT,

  -- Raw file
  filename              TEXT NOT NULL,
  file_kind             statement_file_kind NOT NULL,
  storage_path          TEXT,              -- path inside the 'statement-files' storage bucket
  file_size_bytes        BIGINT,

  -- Detected statement metadata (best-effort — banks format differently)
  bank_name             TEXT,
  account_name          TEXT,
  account_number        TEXT,
  statement_start        DATE,
  statement_end           DATE,

  -- Pipeline status
  status                statement_status NOT NULL DEFAULT 'uploaded',
  extraction_method     TEXT,              -- 'csv' | 'xlsx' | 'pdf_text' | 'ocr'
  total_transactions    INTEGER NOT NULL DEFAULT 0,
  flagged_transactions  INTEGER NOT NULL DEFAULT 0,
  duplicate_transactions INTEGER NOT NULL DEFAULT 0,
  error_message         TEXT,

  -- Cached output so the dashboard/report loads instantly without
  -- recomputation. Regenerated whenever transactions are edited.
  -- Shape: { months, totals, credit, flaggedCount, totalCount, generatedAt }
  report                JSONB,

  uploaded_by           UUID REFERENCES auth.users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_statement_uploads_status ON statement_uploads(status);
CREATE INDEX idx_statement_uploads_created ON statement_uploads(created_at DESC);
CREATE INDEX idx_statement_uploads_customer ON statement_uploads(customer_id);

-- ============================================================
-- STATEMENT TRANSACTIONS
-- "Extracted Transactions" + "Normalised Transactions" collapsed
-- into one table: `raw` preserves exactly what was read off the
-- statement, the typed columns are the normalised values used for
-- analysis. Nothing here overwrites the raw capture.
-- ============================================================

CREATE TABLE statement_transactions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  upload_id       UUID NOT NULL REFERENCES statement_uploads(id) ON DELETE CASCADE,

  txn_date        DATE,
  narration       TEXT NOT NULL DEFAULT '',
  debit           NUMERIC(16,2) NOT NULL DEFAULT 0,
  credit          NUMERIC(16,2) NOT NULL DEFAULT 0,
  balance         NUMERIC(16,2),
  direction       txn_direction,
  category        TEXT NOT NULL DEFAULT 'uncategorised',

  -- Extraction/classification confidence (0.00 - 1.00) and review flag.
  confidence      NUMERIC(3,2) NOT NULL DEFAULT 1.00,
  needs_review    BOOLEAN NOT NULL DEFAULT FALSE,
  review_reason   TEXT,
  reviewed        BOOLEAN NOT NULL DEFAULT FALSE,

  -- Duplicate detection key: hash of (date + narration + debit + credit + balance)
  dedupe_hash     TEXT NOT NULL,
  is_duplicate    BOOLEAN NOT NULL DEFAULT FALSE,

  -- Exactly what was parsed off the source row/line before normalisation.
  raw             JSONB,

  source_row      INTEGER,  -- row/line number in the original file, for traceability

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_statement_txn_upload ON statement_transactions(upload_id);
CREATE INDEX idx_statement_txn_upload_date ON statement_transactions(upload_id, txn_date);
CREATE INDEX idx_statement_txn_review ON statement_transactions(upload_id, needs_review) WHERE needs_review = TRUE;
-- Soft duplicate guard: same statement can't record the exact same line twice.
CREATE UNIQUE INDEX uq_statement_txn_dedupe ON statement_transactions(upload_id, dedupe_hash);

CREATE OR REPLACE FUNCTION touch_statement_upload()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE statement_uploads SET updated_at = NOW() WHERE id = COALESCE(NEW.upload_id, OLD.upload_id);
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_touch_statement_upload
  AFTER INSERT OR UPDATE OR DELETE ON statement_transactions
  FOR EACH ROW EXECUTE FUNCTION touch_statement_upload();

-- ============================================================
-- ROW LEVEL SECURITY
-- Matches the access model used across the rest of ILRMS: any
-- authenticated staff member can read/write. Tighten with
-- role-based checks later if per-branch isolation is needed.
-- ============================================================

ALTER TABLE statement_uploads      ENABLE ROW LEVEL SECURITY;
ALTER TABLE statement_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_all" ON statement_uploads      FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "auth_all" ON statement_transactions FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);

-- ============================================================
-- STORAGE — original uploaded statements
-- Private bucket. Only authenticated staff can read/write.
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('statement-files', 'statement-files', FALSE)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "statement_files_auth_read" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'statement-files');

CREATE POLICY "statement_files_auth_write" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'statement-files');

CREATE POLICY "statement_files_auth_update" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'statement-files');

CREATE POLICY "statement_files_auth_delete" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'statement-files');

-- ============================================================
-- FUTURE (not enabled now — schema left room for these):
--   usage_limits, plans, api_keys tables for the paid-tier /
--   public free-tool direction described in the product brief.
--   Intentionally not created yet per "don't implement
--   monetisation unless necessary for the architecture" — the
--   customer_id/uploaded_by columns above are enough to bolt a
--   per-account quota on top later without a further migration.
-- ============================================================

-- ============================================================
-- DONE
-- ============================================================
