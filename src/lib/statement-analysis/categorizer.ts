// ── Category classification ─────────────────────────────────────────────
// Secondary to the main monthly inflow/outflow summary, per spec — kept
// deliberately simple: keyword heuristics against the narration text.
// Anything that doesn't match a known pattern falls into "Other".

import type { Direction } from "./types";

const INFLOW_RULES: { category: string; patterns: RegExp[] }[] = [
  { category: "Salary", patterns: [/salary/i, /\bpayroll\b/i, /\bwages?\b/i] },
  {
    category: "Transfers",
    patterns: [/\btransfer\b/i, /\bnip\b/i, /\brtgs\b/i, /\bneft\b/i, /inward transfer/i, /\bfrom\b.*\btransfer\b/i],
  },
  { category: "Cash Deposits", patterns: [/cash deposit/i, /\bdeposit\b/i, /cash lodgement/i, /\blodgement\b/i] },
  { category: "Loan Disbursement", patterns: [/loan disbursement/i, /loan credit/i, /facility disbursed/i] },
  { category: "Interest Earned", patterns: [/interest\s*(earned|credit|paid)?/i] },
  { category: "Reversal / Refund", patterns: [/reversal/i, /refund/i, /chargeback/i] },
];

const OUTFLOW_RULES: { category: string; patterns: RegExp[] }[] = [
  { category: "Transfers", patterns: [/\btransfer\b/i, /\bnip\b/i, /\brtgs\b/i, /\bneft\b/i, /outward transfer/i] },
  { category: "Cash Withdrawals", patterns: [/\batm\b/i, /cash withdrawal/i, /\bwithdrawal\b/i, /cash out/i] },
  { category: "Loan Repayment", patterns: [/loan repayment/i, /loan\s*(payment|repay)/i, /instal?ment/i, /facility repayment/i] },
  {
    category: "Bank Charges",
    patterns: [/\bcharge/i, /\bfee\b/i, /\bcommission\b/i, /\bvat\b/i, /stamp duty/i, /maintenance fee/i, /sms alert/i],
  },
  { category: "POS / Card Spend", patterns: [/\bpos\b/i, /card purchase/i, /\bpurchase\b/i] },
  { category: "Bills & Utilities", patterns: [/electricity/i, /\bdstv\b/i, /\bgotv\b/i, /\bstartimes\b/i, /utility/i, /\bwaec\b/i, /\bnepa\b/i] },
  { category: "Airtime / Data", patterns: [/airtime/i, /\bdata\b/i, /recharge/i] },
  { category: "Investment", patterns: [/investment/i, /fixed deposit/i, /treasury bill/i, /\bmutual fund\b/i] },
];

export function categorizeTransaction(narration: string, direction: Direction): string {
  const rules = direction === "inflow" ? INFLOW_RULES : OUTFLOW_RULES;
  for (const rule of rules) {
    if (rule.patterns.some((p) => p.test(narration))) return rule.category;
  }
  return direction === "inflow" ? "Other Inflow" : "Other Outflow";
}

/** True if a category should count toward "existing recurring obligations" in credit analysis. */
export function isObligationCategory(category: string): boolean {
  return category === "Loan Repayment";
}
