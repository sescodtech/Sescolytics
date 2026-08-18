-- ============================================================
-- ILRMS — Charis Microfinance Bank
-- Complete Database Schema
-- Paste this entire file into Supabase SQL Editor and Run
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE app_role AS ENUM (
  'super_admin', 'branch_manager', 'collection_officer',
  'investment_officer', 'auditor'
);

CREATE TYPE customer_status AS ENUM ('active', 'inactive', 'archived');
CREATE TYPE gender AS ENUM ('male', 'female', 'other');

CREATE TYPE loan_status AS ENUM (
  'active', 'due_today', 'due_tomorrow', 'overdue', 'completed'
);

CREATE TYPE collection_status AS ENUM (
  'current', 'reminder_sent', 'follow_up_required',
  'promise_to_pay', 'partially_paid', 'fully_paid'
);

CREATE TYPE repayment_freq AS ENUM (
  'daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'bullet'
);

CREATE TYPE investment_status AS ENUM (
  'active', 'maturing_soon', 'matured', 'renewed', 'closed'
);

CREATE TYPE ptp_status AS ENUM ('pending', 'fulfilled', 'broken');

CREATE TYPE reminder_channel AS ENUM ('sms', 'whatsapp', 'email');
CREATE TYPE reminder_status AS ENUM ('queued', 'sent', 'failed');
CREATE TYPE import_status AS ENUM ('processing', 'completed', 'failed');


-- ============================================================
-- BRANCHES
-- ============================================================

CREATE TABLE branches (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  code        TEXT NOT NULL UNIQUE,
  address     TEXT,
  phone       TEXT,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed default branches
INSERT INTO branches (name, code, address) VALUES
  ('Head Office', 'HQ', 'Lagos, Nigeria'),
  ('Branch 1',   'B1', 'Nigeria'),
  ('Branch 2',   'B2', 'Nigeria');


-- ============================================================
-- PROFILES (mirrors auth.users)
-- ============================================================

CREATE TABLE profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name   TEXT NOT NULL,
  email       TEXT NOT NULL,
  phone       TEXT,
  branch_id   UUID REFERENCES branches(id),
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO profiles (id, full_name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.email
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();


-- ============================================================
-- USER ROLES
-- ============================================================

CREATE TABLE user_roles (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, role)
);

-- Auto-assign super_admin to FIRST user ever
CREATE OR REPLACE FUNCTION assign_first_user_super_admin()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (SELECT COUNT(*) FROM user_roles) = 0 THEN
    INSERT INTO user_roles (user_id, role) VALUES (NEW.id, 'super_admin');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_first_profile_created
  AFTER INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION assign_first_user_super_admin();

-- Role check helpers
CREATE OR REPLACE FUNCTION has_role(_user_id UUID, _role TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = _user_id AND role = _role::app_role
  );
$$;

CREATE OR REPLACE FUNCTION has_any_role(_user_id UUID, _roles TEXT[])
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = _user_id AND role = ANY(_roles::app_role[])
  );
$$;


-- ============================================================
-- CUSTOMERS
-- ============================================================

CREATE TABLE customers (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_code TEXT NOT NULL UNIQUE,
  full_name     TEXT NOT NULL,
  phone         TEXT NOT NULL,
  email         TEXT,
  address       TEXT,
  gender        gender,
  branch_id     UUID REFERENCES branches(id),
  status        customer_status NOT NULL DEFAULT 'active',
  date_joined   DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by    UUID REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_customers_status    ON customers(status);
CREATE INDEX idx_customers_branch    ON customers(branch_id);
CREATE INDEX idx_customers_phone     ON customers(phone);


-- ============================================================
-- LOANS
-- ============================================================

CREATE TABLE loans (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  loan_number          TEXT NOT NULL UNIQUE,
  customer_id          UUID REFERENCES customers(id),
  customer_name        TEXT NOT NULL,
  customer_phone       TEXT,
  branch_id            UUID REFERENCES branches(id),
  principal_amount     NUMERIC(15,2) NOT NULL,
  interest_amount      NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_amount         NUMERIC(15,2) NOT NULL,
  amount_paid          NUMERIC(15,2) NOT NULL DEFAULT 0,
  outstanding_balance  NUMERIC(15,2) NOT NULL,
  start_date           DATE NOT NULL,
  due_date             DATE NOT NULL,
  next_due_date        DATE,
  repayment_frequency  repayment_freq NOT NULL DEFAULT 'monthly',
  status               loan_status NOT NULL DEFAULT 'active',
  collection_status    collection_status NOT NULL DEFAULT 'current',
  assigned_officer_id  UUID REFERENCES auth.users(id),
  import_batch_id      UUID,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_loans_status             ON loans(status);
CREATE INDEX idx_loans_collection_status  ON loans(collection_status);
CREATE INDEX idx_loans_due_date           ON loans(due_date);
CREATE INDEX idx_loans_customer_id        ON loans(customer_id);
CREATE INDEX idx_loans_branch             ON loans(branch_id);


-- ============================================================
-- REPAYMENTS
-- ============================================================

CREATE TABLE repayments (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  loan_id      UUID NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  amount       NUMERIC(15,2) NOT NULL,
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  method       TEXT,
  reference    TEXT,
  notes        TEXT,
  recorded_by  UUID REFERENCES auth.users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_repayments_loan_id      ON repayments(loan_id);
CREATE INDEX idx_repayments_payment_date ON repayments(payment_date);


-- ============================================================
-- COLLECTION NOTES
-- ============================================================

CREATE TABLE collection_notes (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  loan_id    UUID NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  note       TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_collection_notes_loan ON collection_notes(loan_id);


-- ============================================================
-- INVESTMENTS
-- ============================================================

CREATE TABLE investments (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  investment_number  TEXT NOT NULL UNIQUE,
  customer_id        UUID NOT NULL REFERENCES customers(id),
  branch_id          UUID REFERENCES branches(id),
  amount             NUMERIC(15,2) NOT NULL,
  interest_rate      NUMERIC(6,3) NOT NULL,
  duration_days      INTEGER NOT NULL,
  start_date         DATE NOT NULL,
  maturity_date      DATE NOT NULL,
  status             investment_status NOT NULL DEFAULT 'active',
  notes              TEXT,
  renewed_from       UUID REFERENCES investments(id),
  created_by         UUID REFERENCES auth.users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_investments_status        ON investments(status);
CREATE INDEX idx_investments_customer_id   ON investments(customer_id);
CREATE INDEX idx_investments_maturity_date ON investments(maturity_date);


-- ============================================================
-- PROMISE TO PAY
-- ============================================================

CREATE TABLE promise_to_pay (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  loan_id         UUID NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  customer_id     UUID REFERENCES customers(id),
  promised_amount NUMERIC(15,2) NOT NULL,
  promise_date    DATE NOT NULL,
  status          ptp_status NOT NULL DEFAULT 'pending',
  notes           TEXT,
  created_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ptp_loan_id ON promise_to_pay(loan_id);
CREATE INDEX idx_ptp_status  ON promise_to_pay(status);


-- ============================================================
-- REMINDER TEMPLATES
-- ============================================================

CREATE TABLE reminder_templates (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name       TEXT NOT NULL,
  channel    reminder_channel NOT NULL,
  subject    TEXT,
  body       TEXT NOT NULL,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed default templates
INSERT INTO reminder_templates (name, channel, subject, body) VALUES
  ('3-Day Due Reminder', 'sms', NULL,
   'Dear {customer_name}, your loan {loan_number} of ₦{amount} is due in 3 days on {due_date}. Please ensure timely payment. - Charis MFB'),
  ('Due Today Alert', 'whatsapp', NULL,
   'Hello {customer_name}, your loan repayment of ₦{outstanding} is DUE TODAY ({due_date}). Please visit any branch or transfer to our account. Thank you - Charis Microfinance Bank'),
  ('Overdue Notice', 'email', 'Overdue Loan Repayment Notice — {loan_number}',
   'Dear {customer_name},\n\nThis is to inform you that your loan {loan_number} with an outstanding balance of ₦{outstanding} is now OVERDUE as of {due_date}.\n\nPlease make payment immediately to avoid further charges.\n\nRegards,\nCharis Microfinance Bank');


-- ============================================================
-- REMINDERS
-- ============================================================

CREATE TABLE reminders (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  loan_id     UUID REFERENCES loans(id),
  customer_id UUID REFERENCES customers(id),
  template_id UUID REFERENCES reminder_templates(id),
  channel     reminder_channel NOT NULL,
  recipient   TEXT NOT NULL,
  subject     TEXT,
  message     TEXT NOT NULL,
  status      reminder_status NOT NULL DEFAULT 'queued',
  reason      TEXT,
  sent_at     TIMESTAMPTZ,
  error       TEXT,
  sent_by     UUID REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reminders_loan_id    ON reminders(loan_id);
CREATE INDEX idx_reminders_status     ON reminders(status);
CREATE INDEX idx_reminders_created_at ON reminders(created_at);


-- ============================================================
-- LOAN IMPORT BATCHES
-- ============================================================

CREATE TABLE loan_import_batches (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  filename           TEXT NOT NULL,
  total_records      INTEGER NOT NULL DEFAULT 0,
  successful_records INTEGER NOT NULL DEFAULT 0,
  failed_records     INTEGER NOT NULL DEFAULT 0,
  status             import_status NOT NULL DEFAULT 'processing',
  errors_json        JSONB,
  uploaded_by        UUID REFERENCES auth.users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- AUDIT LOGS
-- ============================================================

CREATE TABLE audit_logs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID REFERENCES auth.users(id),
  user_email  TEXT,
  action      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   TEXT,
  metadata    JSONB,
  ip_address  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_user_id    ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX idx_audit_logs_entity     ON audit_logs(entity_type, entity_id);


-- ============================================================
-- SYSTEM SETTINGS
-- ============================================================

CREATE TABLE system_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO system_settings (key, value) VALUES
  ('bank_name',        '"Charis Microfinance Bank"'),
  ('currency',         '"NGN"'),
  ('default_interest', '18'),
  ('overdue_penalty',  '2');


-- ============================================================
-- STATUS REFRESH FUNCTIONS
-- ============================================================

CREATE OR REPLACE FUNCTION refresh_loan_statuses()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Overdue
  UPDATE loans SET status = 'overdue'
  WHERE due_date < CURRENT_DATE AND status NOT IN ('completed', 'overdue');

  -- Due today
  UPDATE loans SET status = 'due_today'
  WHERE due_date = CURRENT_DATE AND status NOT IN ('completed', 'overdue');

  -- Due tomorrow
  UPDATE loans SET status = 'due_tomorrow'
  WHERE due_date = CURRENT_DATE + 1 AND status NOT IN ('completed', 'overdue');

  -- Back to active if future date
  UPDATE loans SET status = 'active'
  WHERE due_date > CURRENT_DATE + 1 AND status NOT IN ('completed');
END;
$$;

CREATE OR REPLACE FUNCTION refresh_investment_statuses()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Matured
  UPDATE investments SET status = 'matured'
  WHERE maturity_date < CURRENT_DATE AND status NOT IN ('matured', 'renewed', 'closed');

  -- Maturing soon (within 7 days)
  UPDATE investments SET status = 'maturing_soon'
  WHERE maturity_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7
    AND status = 'active';
END;
$$;


-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE profiles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE branches           ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE loans              ENABLE ROW LEVEL SECURITY;
ALTER TABLE repayments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_notes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE investments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE promise_to_pay     ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminder_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminders          ENABLE ROW LEVEL SECURITY;
ALTER TABLE loan_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_settings    ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read/write everything (role checks in app layer)
-- You can tighten these per role later

CREATE POLICY "auth_all" ON profiles           FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "auth_all" ON user_roles         FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "auth_all" ON branches           FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "auth_all" ON customers          FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "auth_all" ON loans              FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "auth_all" ON repayments         FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "auth_all" ON collection_notes   FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "auth_all" ON investments        FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "auth_all" ON promise_to_pay     FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "auth_all" ON reminder_templates FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "auth_all" ON reminders          FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "auth_all" ON loan_import_batches FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "auth_all" ON audit_logs         FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "auth_all" ON system_settings    FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);

-- ============================================================
-- DONE — Run refresh functions once to initialise statuses
-- ============================================================
SELECT refresh_loan_statuses();
SELECT refresh_investment_statuses();
