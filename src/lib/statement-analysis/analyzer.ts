// ── Stage 4-5: Analyse Transactions → Monthly Summary → Credit Analysis ────
// The monthly Inflow/Outflow table is the primary output (per spec); the
// category breakdown and credit assessment are built from the same
// transaction set so every number traces back to an actual row.

import type {
  NormalizedTransaction,
  MonthlyBucket,
  CreditAnalysis,
  StatementReport,
  CategoryBreakdown,
} from "./types";
import { isObligationCategory } from "./categorizer";

const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-");
  return `${MONTH_LABELS[parseInt(m, 10) - 1]} ${y}`;
}

/** Only clean, non-duplicate transactions with a usable date feed the analysis totals. */
function usable(transactions: NormalizedTransaction[]): NormalizedTransaction[] {
  return transactions.filter((t) => t.date && !t.isDuplicate);
}

export function buildMonthlySummary(transactions: NormalizedTransaction[]): MonthlyBucket[] {
  const clean = usable(transactions);
  const buckets = new Map<string, MonthlyBucket>();

  // Sort chronologically first so "ending balance" picks the last known
  // balance in each month correctly.
  const sorted = [...clean].sort((a, b) => (a.date! < b.date! ? -1 : a.date! > b.date! ? 1 : 0));

  for (const t of sorted) {
    const monthKey = t.date!.slice(0, 7);
    if (!buckets.has(monthKey)) {
      buckets.set(monthKey, {
        monthKey,
        monthLabel: monthLabel(monthKey),
        inflow: 0,
        outflow: 0,
        net: 0,
        txnCount: 0,
        endingBalance: null,
        inflowBreakdown: {},
        outflowBreakdown: {},
      });
    }
    const b = buckets.get(monthKey)!;
    b.txnCount += 1;

    if (t.direction === "inflow") {
      b.inflow += t.credit;
      addToBreakdown(b.inflowBreakdown, t.category, t.credit);
    } else {
      b.outflow += t.debit;
      addToBreakdown(b.outflowBreakdown, t.category, t.debit);
    }
    if (t.balance !== null) b.endingBalance = t.balance;
  }

  const months = Array.from(buckets.values()).sort((a, b) => a.monthKey.localeCompare(b.monthKey));
  months.forEach((m) => {
    m.net = Number((m.inflow - m.outflow).toFixed(2));
    m.inflow = Number(m.inflow.toFixed(2));
    m.outflow = Number(m.outflow.toFixed(2));
  });
  return months;
}

function addToBreakdown(breakdown: CategoryBreakdown, category: string, amount: number) {
  breakdown[category] = Number(((breakdown[category] || 0) + amount).toFixed(2));
}

export function buildCreditAnalysis(transactions: NormalizedTransaction[], months: MonthlyBucket[]): CreditAnalysis {
  const clean = usable(transactions);
  const monthsAnalyzed = months.length;

  const totalInflow = months.reduce((s, m) => s + m.inflow, 0);
  const totalOutflow = months.reduce((s, m) => s + m.outflow, 0);
  const avgMonthlyInflow = monthsAnalyzed ? totalInflow / monthsAnalyzed : 0;
  const avgMonthlyOutflow = monthsAnalyzed ? totalOutflow / monthsAnalyzed : 0;
  const avgMonthlyNet = avgMonthlyInflow - avgMonthlyOutflow;

  const balances = clean.filter((t) => t.balance !== null).map((t) => t.balance as number);
  const avgBalance = balances.length ? balances.reduce((a, b) => a + b, 0) / balances.length : 0;
  const lowestBalance = balances.length ? Math.min(...balances) : null;
  const highestBalance = balances.length ? Math.max(...balances) : null;

  const obligationOutflows = clean.filter((t) => t.direction === "outflow" && isObligationCategory(t.category));
  const totalObligations = obligationOutflows.reduce((s, t) => s + t.debit, 0);
  const existingObligations = monthsAnalyzed ? totalObligations / monthsAnalyzed : 0;

  // Income consistency: coefficient of variation of monthly inflow, inverted
  // into a 0-100 "consistency" score (100 = perfectly steady income).
  const inflows = months.map((m) => m.inflow);
  const meanInflow = inflows.length ? inflows.reduce((a, b) => a + b, 0) / inflows.length : 0;
  const variance = inflows.length
    ? inflows.reduce((s, v) => s + Math.pow(v - meanInflow, 2), 0) / inflows.length
    : 0;
  const stdDev = Math.sqrt(variance);
  const coefficientOfVariation = meanInflow > 0 ? stdDev / meanInflow : 1;
  const incomeConsistencyPct = Math.round(Math.max(0, Math.min(1, 1 - coefficientOfVariation)) * 100);

  // Cashflow stability: share of months that closed with a non-negative net.
  const positiveMonths = months.filter((m) => m.net >= 0).length;
  const negativeMonths = monthsAnalyzed - positiveMonths;
  const cashflowStabilityPct = monthsAnalyzed ? Math.round((positiveMonths / monthsAnalyzed) * 100) : 0;

  // ── Assessment ────────────────────────────────────────────────────────
  // Deliberately simple, explainable rules — the figures above are shown
  // alongside the label so nothing here is an unexplained black-box score.
  const notes: string[] = [];
  let points = 0;

  if (avgMonthlyNet > 0) {
    points += 2;
    notes.push("Average monthly net cash flow is positive.");
  } else {
    notes.push("Average monthly net cash flow is negative or break-even.");
  }

  if (incomeConsistencyPct >= 70) {
    points += 2;
    notes.push(`Monthly inflow is fairly consistent (${incomeConsistencyPct}% consistency score).`);
  } else if (incomeConsistencyPct >= 40) {
    points += 1;
    notes.push(`Monthly inflow is moderately variable (${incomeConsistencyPct}% consistency score).`);
  } else {
    notes.push(`Monthly inflow is highly variable (${incomeConsistencyPct}% consistency score).`);
  }

  if (cashflowStabilityPct >= 75) {
    points += 2;
    notes.push(`${positiveMonths} of ${monthsAnalyzed} months closed with a positive net cash flow.`);
  } else if (cashflowStabilityPct >= 50) {
    points += 1;
    notes.push(`${positiveMonths} of ${monthsAnalyzed} months closed with a positive net cash flow.`);
  } else {
    notes.push(`Only ${positiveMonths} of ${monthsAnalyzed} months closed with a positive net cash flow.`);
  }

  if (existingObligations > 0 && avgMonthlyInflow > 0) {
    const obligationRatio = existingObligations / avgMonthlyInflow;
    if (obligationRatio < 0.3) {
      points += 1;
      notes.push(`Existing loan repayments use about ${(obligationRatio * 100).toFixed(0)}% of average monthly inflow.`);
    } else {
      notes.push(`Existing loan repayments use about ${(obligationRatio * 100).toFixed(0)}% of average monthly inflow — high relative to income.`);
    }
  }

  if (monthsAnalyzed < 3) {
    notes.push(`Only ${monthsAnalyzed} month(s) of statement data available — assessment confidence is limited.`);
  }

  let assessment: CreditAnalysis["assessment"];
  if (monthsAnalyzed < 2) {
    assessment = "Low";
    notes.push("Insufficient statement history (minimum 2 months recommended) to assess with confidence.");
  } else if (points >= 6) {
    assessment = "Strong";
  } else if (points >= 3) {
    assessment = "Moderate";
  } else {
    assessment = "Low";
  }

  return {
    monthsAnalyzed,
    avgMonthlyInflow: Number(avgMonthlyInflow.toFixed(2)),
    avgMonthlyOutflow: Number(avgMonthlyOutflow.toFixed(2)),
    avgMonthlyNet: Number(avgMonthlyNet.toFixed(2)),
    avgBalance: Number(avgBalance.toFixed(2)),
    lowestBalance: lowestBalance !== null ? Number(lowestBalance.toFixed(2)) : null,
    highestBalance: highestBalance !== null ? Number(highestBalance.toFixed(2)) : null,
    existingObligations: Number(existingObligations.toFixed(2)),
    incomeConsistencyPct,
    cashflowStabilityPct,
    positiveMonths,
    negativeMonths,
    assessment,
    assessmentNotes: notes,
  };
}

export function buildReport(transactions: NormalizedTransaction[]): StatementReport {
  const months = buildMonthlySummary(transactions);
  const credit = buildCreditAnalysis(transactions, months);

  const totalInflow = months.reduce((s, m) => s + m.inflow, 0);
  const totalOutflow = months.reduce((s, m) => s + m.outflow, 0);

  return {
    months,
    totals: {
      inflow: Number(totalInflow.toFixed(2)),
      outflow: Number(totalOutflow.toFixed(2)),
      net: Number((totalInflow - totalOutflow).toFixed(2)),
      avgMonthlyInflow: credit.avgMonthlyInflow,
      avgMonthlyOutflow: credit.avgMonthlyOutflow,
    },
    credit,
    flaggedCount: transactions.filter((t) => t.needsReview).length,
    duplicateCount: transactions.filter((t) => t.isDuplicate).length,
    totalCount: transactions.length,
    generatedAt: new Date().toISOString(),
  };
}
