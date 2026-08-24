// ── Shared column-alias definitions ─────────────────────────────────────
// One source of truth for "what does this column probably mean" so the
// live preview checklist (shown before import) and the actual row
// extraction can never drift apart from each other.

export const LOAN_FIELD_ALIASES: Record<string, string[]> = {
  loan_number: ["loan_number", "loan number", "loan_no", "loan no", "loanno", "loan ref", "loan_ref", "account_number", "account number", "acct_no", "reference"],
  customer_name: ["customer_name", "customer name", "borrower", "borrower_name", "client", "client_name", "name", "full_name", "fullname"],
  customer_phone: ["customer_phone", "phone", "mobile", "phone_number", "telephone", "borrower_phone", "contact"],
  customer_email: ["customer_email", "email", "email_address", "email address", "borrower_email", "contact_email"],
  principal_amount: ["principal_amount", "principal", "loan_amount", "loan amount", "disbursed_amount", "disbursed amount"],
  interest_amount: ["interest_amount", "interest", "interest amount", "total_interest"],
  total_amount: ["total_amount", "total amount", "total", "repayment_amount"],
  amount_paid: ["amount_paid", "amount paid", "paid", "payment_made", "total_paid"],
  outstanding_balance: ["outstanding_balance", "outstanding", "balance", "outstanding balance", "amount_due"],
  start_date: ["start_date", "start date", "disbursement_date", "disbursement date", "value_date", "issue_date"],
  due_date: ["due_date", "due date", "maturity_date", "maturity date", "end_date", "repayment_date"],
  repayment_frequency: ["repayment_frequency", "frequency", "repayment_freq", "payment_frequency", "tenor_type"],
};

export const LOAN_FIELD_LABELS: Record<string, string> = {
  loan_number: "Loan Number",
  customer_name: "Customer Name",
  customer_phone: "Phone",
  customer_email: "Email",
  principal_amount: "Principal Amount",
  interest_amount: "Interest Amount",
  total_amount: "Total Amount",
  amount_paid: "Amount Paid",
  outstanding_balance: "Outstanding Balance",
  start_date: "Start Date",
  due_date: "Due Date",
  repayment_frequency: "Repayment Frequency",
};

export const LOAN_REQUIRED_FIELDS = ["loan_number"];

export const INVESTMENT_FIELD_ALIASES: Record<string, string[]> = {
  investment_number: ["investment_number", "investment number", "inv_number", "inv number", "inv_no", "inv no", "reference", "ref", "account_number", "account number", "investment_ref", "certificate_number"],
  customer_name: ["customer_name", "customer name", "investor", "investor_name", "client", "client_name", "name", "full_name", "depositor"],
  customer_phone: ["customer_phone", "phone", "mobile", "telephone", "investor_phone", "contact"],
  customer_email: ["customer_email", "email", "email_address", "email address", "investor_email", "contact_email"],
  amount: ["amount", "investment_amount", "investment amount", "principal", "deposit_amount", "deposit amount", "face_value", "value"],
  interest_rate: ["interest_rate", "interest rate", "rate", "rate_%", "interest_%", "coupon_rate", "yield", "annual_rate"],
  start_date: ["start_date", "start date", "value_date", "value date", "issue_date", "booking_date", "date_opened"],
  maturity_date: ["maturity_date", "maturity date", "end_date", "due_date", "expiry_date", "date_due", "rollover_date"],
  duration_days: ["duration_days", "duration", "tenor", "tenor_days", "days"],
  notes: ["notes", "remarks", "comment", "description", "narration"],
};

export const INVESTMENT_FIELD_LABELS: Record<string, string> = {
  investment_number: "Investment Number",
  customer_name: "Customer Name",
  customer_phone: "Phone",
  customer_email: "Email",
  amount: "Amount",
  interest_rate: "Interest Rate",
  start_date: "Start Date",
  maturity_date: "Maturity Date",
  duration_days: "Duration (days)",
  notes: "Notes",
};

export const INVESTMENT_REQUIRED_FIELDS = ["investment_number"];

function normHeader(h: string): string {
  return h.toLowerCase().trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

export interface FieldMappingEntry {
  field: string;
  label: string;
  matchedColumn: string | null;
  required: boolean;
}

/** Given the file's column names, show which expected fields were detected — for the pre-import checklist. */
export function detectFieldMapping(
  columnNames: string[],
  aliases: Record<string, string[]>,
  labels: Record<string, string>,
  requiredFields: string[]
): FieldMappingEntry[] {
  const normalizedCols = columnNames.map((c) => ({ raw: c, norm: normHeader(c) }));
  return Object.entries(aliases).map(([field, fieldAliases]) => {
    const match = normalizedCols.find((c) => fieldAliases.includes(c.norm));
    return {
      field,
      label: labels[field] || field,
      matchedColumn: match?.raw ?? null,
      required: requiredFields.includes(field),
    };
  });
}
