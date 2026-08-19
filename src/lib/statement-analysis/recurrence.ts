// ── Recurring transaction detection (salary, obligations, subscriptions) ──
// Deliberately NOT keyword-based ("SALARY" in the text) — real payrolls,
// especially from smaller employers, often don't say "salary" at all.
// Instead: group transactions by a normalised narration signature, then
// check whether that group repeats across months at a similar amount and
// a similar day of month. That combination — same counterparty, same
// rough amount, same rough date, month after month — is what a recurring
// income or obligation actually looks like on a statement.

import type { Direction, NormalizedTransaction, RecurringPattern } from "./types";

/** Strip the volatile parts of a narration (refs, dates, running numbers) so
 *  the same counterparty/payment groups together across months. */
function narrationSignature(narration: string): string {
  return narration
    .toLowerCase()
    .replace(/\b\d{4,}\b/g, "") // long reference/account numbers
    .replace(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g, "") // embedded dates
    .replace(/\b(ref|reference|txn|trx|transaction)\s*[:#]?\s*\S*/g, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

/** Circular-ish day-of-month spread (handles e.g. 1st vs 28th of a short month loosely). */
function dayOfMonthSpread(days: number[]): number {
  return stdDev(days);
}

export function detectRecurringPatterns(
  transactions: NormalizedTransaction[],
  direction: Direction,
  monthsAnalyzed: number
): RecurringPattern[] {
  const clean = transactions.filter((t) => t.date && !t.isDuplicate && t.direction === direction);
  const groups = new Map<string, NormalizedTransaction[]>();

  for (const t of clean) {
    const sig = narrationSignature(t.narration);
    if (sig.length < 3) continue; // too generic to group meaningfully
    if (!groups.has(sig)) groups.set(sig, []);
    groups.get(sig)!.push(t);
  }

  const patterns: RecurringPattern[] = [];

  for (const [signature, items] of groups) {
    // Only one occurrence per month counts toward "recurring" — collapse same-day duplicates.
    const byMonth = new Map<string, NormalizedTransaction>();
    for (const t of items) {
      const monthKey = t.date!.slice(0, 7);
      const existing = byMonth.get(monthKey);
      const amount = direction === "inflow" ? t.credit : t.debit;
      if (!existing || amount > (direction === "inflow" ? existing.credit : existing.debit)) {
        byMonth.set(monthKey, t);
      }
    }

    // Needs to show up in at least 2 distinct months (or all months if only 2-3 available)
    // to count as "recurring" rather than a one-off.
    const minMonths = monthsAnalyzed <= 2 ? monthsAnalyzed : 2;
    if (byMonth.size < Math.max(2, minMonths)) continue;

    const monthEntries = Array.from(byMonth.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    const amounts = monthEntries.map(([, t]) => (direction === "inflow" ? t.credit : t.debit));
    const days = monthEntries.map(([, t]) => new Date(t.date!).getDate());

    const avgAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const amountCv = avgAmount > 0 ? stdDev(amounts) / avgAmount : 1;
    const amountConsistencyPct = Math.round(Math.max(0, Math.min(1, 1 - amountCv)) * 100);

    const avgDayOfMonth = days.reduce((a, b) => a + b, 0) / days.length;
    const daySpread = dayOfMonthSpread(days);
    const dayOfMonthConsistencyPct = Math.round(Math.max(0, Math.min(1, 1 - daySpread / 10)) * 100);

    // Coverage: what share of the analysed months does this pattern appear in.
    const coveragePct = monthsAnalyzed > 0 ? Math.min(1, byMonth.size / monthsAnalyzed) : 0;

    const confidencePct = Math.round(
      amountConsistencyPct * 0.4 + dayOfMonthConsistencyPct * 0.3 + coveragePct * 100 * 0.3
    );

    const sample = monthEntries[monthEntries.length - 1][1];

    patterns.push({
      signature,
      sampleNarration: sample.narration,
      direction,
      category: sample.category,
      avgAmount: Number(avgAmount.toFixed(2)),
      minAmount: Number(Math.min(...amounts).toFixed(2)),
      maxAmount: Number(Math.max(...amounts).toFixed(2)),
      occurrences: byMonth.size,
      monthsSeen: monthEntries.map(([m]) => m),
      avgDayOfMonth: Math.round(avgDayOfMonth),
      dayOfMonthConsistencyPct,
      amountConsistencyPct,
      confidencePct,
      isLikelyIncome: direction === "inflow" && confidencePct >= 55,
    });
  }

  return patterns.sort((a, b) => b.confidencePct * b.avgAmount - a.confidencePct * a.avgAmount);
}

/** Best-guess primary income: the highest-confidence, highest-value recurring inflow. */
export function detectPrimaryIncome(transactions: NormalizedTransaction[], monthsAnalyzed: number): RecurringPattern | null {
  const patterns = detectRecurringPatterns(transactions, "inflow", monthsAnalyzed).filter((p) => p.isLikelyIncome);
  return patterns[0] || null;
}

/** Recurring outflows worth calling out as obligations — loan repayments, subscriptions,
 *  standing orders — even when the narration doesn't literally say "loan". */
export function detectRecurringObligations(transactions: NormalizedTransaction[], monthsAnalyzed: number): RecurringPattern[] {
  return detectRecurringPatterns(transactions, "outflow", monthsAnalyzed)
    .filter((p) => p.confidencePct >= 45)
    .slice(0, 8);
}
