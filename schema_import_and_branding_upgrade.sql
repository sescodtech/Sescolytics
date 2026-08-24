-- ============================================================
-- ILRMS — Data Import, Reminder & Branding Upgrade
--
-- Additive migration. Does NOT touch the Statement Analysis
-- module (statement_uploads / statement_transactions / the
-- statement-files storage bucket) — those are left completely
-- alone per instructions.
--
-- Paste into the Supabase SQL Editor and Run.
-- ============================================================

-- ── Richer import batch reporting ───────────────────────────
-- Previously only successful/failed were tracked, which couldn't
-- distinguish "created new record" from "updated an existing one" —
-- needed so imports never blindly duplicate records.
ALTER TABLE loan_import_batches
  ADD COLUMN IF NOT EXISTS new_records     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_records INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS review_records  INTEGER NOT NULL DEFAULT 0;

-- ── Configurable application branding ───────────────────────
-- system_settings already exists as a flexible key/value table
-- (see schema.sql) — just seeding the new keys an admin can edit
-- from Settings → General. Nothing is hard-coded to "Charis" going
-- forward; these are the fallback values only.
INSERT INTO system_settings (key, value) VALUES
  ('app_name', '"ILRMS"'),
  ('org_name', '"Charis Microfinance Bank"'),
  ('logo_url', 'null')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- DONE
-- ============================================================
