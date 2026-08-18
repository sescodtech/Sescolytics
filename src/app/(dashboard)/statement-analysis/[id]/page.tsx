"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Download, Building2, Calendar, AlertTriangle, CheckCircle2,
  TrendingUp, TrendingDown, Wallet, Search, ChevronDown, ChevronUp,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import { StatCard } from "@/components/StatCard";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { getUpload, listTransactions, updateTransaction } from "@/lib/statement-analysis/data";
import { exportStatementReportPdf } from "@/lib/statement-analysis/reportExport";
import type { StatementTransactionRow } from "@/lib/statement-analysis/types";
import { toast } from "sonner";

const ASSESSMENT_COLOR: Record<string, string> = {
  Strong: "bg-green-100 text-green-800 border-green-200",
  Moderate: "bg-amber-100 text-amber-800 border-amber-200",
  Low: "bg-red-100 text-red-800 border-red-200",
};

export default function StatementDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const queryClient = useQueryClient();
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [reviewOnly, setReviewOnly] = useState(false);
  const [search, setSearch] = useState("");

  const { data: upload, isLoading: uploadLoading } = useQuery({
    queryKey: ["statement-upload", id],
    queryFn: () => getUpload(id),
  });

  const { data: transactions = [], isLoading: txnLoading } = useQuery({
    queryKey: ["statement-transactions", id],
    queryFn: () => listTransactions(id),
    enabled: !!upload,
  });

  const filteredTxns = useMemo(() => {
    let list = transactions as StatementTransactionRow[];
    if (reviewOnly) list = list.filter((t) => t.needs_review && !t.reviewed);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((t) => t.narration.toLowerCase().includes(q) || t.category.toLowerCase().includes(q));
    }
    return list;
  }, [transactions, reviewOnly, search]);

  const chartData = useMemo(
    () => (upload?.report?.months || []).map((m) => ({ name: m.monthLabel.split(" ")[0].slice(0, 3), Inflow: m.inflow, Outflow: m.outflow })),
    [upload]
  );

  const handleMarkReviewed = async (txn: StatementTransactionRow) => {
    try {
      await updateTransaction(txn.id, { reviewed: !txn.reviewed });
      queryClient.invalidateQueries({ queryKey: ["statement-transactions", id] });
    } catch {
      toast.error("Failed to update");
    }
  };

  if (uploadLoading) {
    return <div className="p-6 max-w-6xl mx-auto"><div className="h-40 bg-muted animate-pulse rounded-xl" /></div>;
  }

  if (!upload) {
    return (
      <div className="p-6 max-w-6xl mx-auto text-center py-20">
        <p className="text-muted-foreground">Statement analysis not found.</p>
        <Link href="/statement-analysis" className="text-primary text-sm font-medium mt-2 inline-block">
          ← Back to Statement Analysis
        </Link>
      </div>
    );
  }

  const report = upload.report;

  return (
    <div className="p-6 max-w-6xl mx-auto pb-16">
      <Link href="/statement-analysis" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="w-4 h-4" /> Back to Statement Analysis
      </Link>

      <PageHeader
        title={upload.applicant_name || upload.filename}
        description={`${upload.bank_name || "Bank not detected"} ${upload.account_number ? `· ${upload.account_number}` : ""}`}
      >
        {report && (
          <button
            onClick={() => exportStatementReportPdf(upload, report)}
            className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted/40"
          >
            <Download className="w-4 h-4" /> Export Report
          </button>
        )}
      </PageHeader>

      {upload.status === "failed" && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 text-sm text-red-700">
          {upload.error_message || "This statement could not be processed."}
        </div>
      )}

      {!report ? (
        <div className="bg-muted/30 border border-border rounded-xl p-10 text-center text-muted-foreground">
          No report available for this upload yet.
        </div>
      ) : (
        <>
          {/* Statement meta strip */}
          <div className="flex flex-wrap items-center gap-4 mb-6 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5" /> {upload.account_name || "Account name not detected"}</span>
            <span className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5" />
              {upload.statement_start ? formatDate(upload.statement_start) : "—"} – {upload.statement_end ? formatDate(upload.statement_end) : "—"}
            </span>
            {upload.flagged_transactions > 0 && (
              <span className="flex items-center gap-1.5 text-amber-600">
                <AlertTriangle className="w-3.5 h-3.5" /> {upload.flagged_transactions} rows flagged for review
              </span>
            )}
            {upload.duplicate_transactions > 0 && (
              <span className="flex items-center gap-1.5">
                {upload.duplicate_transactions} duplicate rows excluded from totals
              </span>
            )}
          </div>

          {/* Top-level figures */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
            <StatCard title="Total Inflow" value={formatCurrency(report.totals.inflow)} icon={TrendingUp} iconColor="text-success" iconBg="bg-success/10" />
            <StatCard title="Total Outflow" value={formatCurrency(report.totals.outflow)} icon={TrendingDown} iconColor="text-destructive" iconBg="bg-destructive/10" />
            <StatCard
              title="Net Cash Flow"
              value={formatCurrency(report.totals.net)}
              icon={Wallet}
              iconColor={report.totals.net >= 0 ? "text-success" : "text-destructive"}
              iconBg={report.totals.net >= 0 ? "bg-success/10" : "bg-destructive/10"}
            />
            <StatCard title="Avg Monthly Inflow" value={formatCurrency(report.totals.avgMonthlyInflow)} icon={TrendingUp} iconColor="text-primary" iconBg="bg-primary/10" />
            <StatCard title="Avg Monthly Outflow" value={formatCurrency(report.totals.avgMonthlyOutflow)} icon={TrendingDown} iconColor="text-primary" iconBg="bg-primary/10" />
          </div>

          {/* MAIN OUTPUT: Monthly Summary */}
          <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden mb-6">
            <div className="px-5 py-4 border-b border-border">
              <h2 className="text-sm font-semibold text-foreground">Monthly Summary</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Inflow vs outflow, calculated directly from extracted transactions</p>
            </div>

            {chartData.length > 0 && (
              <div className="px-5 pt-5" style={{ height: 220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `₦${(v / 1000).toFixed(0)}k`} />
                    <Tooltip formatter={(v: number) => formatCurrency(v)} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="Inflow" fill="hsl(var(--success))" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Outflow" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            <div className="overflow-x-auto mt-2">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">Month</th>
                    <th className="text-right px-5 py-3 text-xs font-medium text-muted-foreground">Inflow</th>
                    <th className="text-right px-5 py-3 text-xs font-medium text-muted-foreground">Outflow</th>
                    <th className="text-right px-5 py-3 text-xs font-medium text-muted-foreground">Net</th>
                    <th className="text-right px-5 py-3 text-xs font-medium text-muted-foreground">Txns</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {report.months.map((m) => (
                    <tr key={m.monthKey} className="hover:bg-muted/20">
                      <td className="px-5 py-3 font-medium text-foreground">{m.monthLabel}</td>
                      <td className="px-5 py-3 text-right text-success font-medium">{formatCurrency(m.inflow)}</td>
                      <td className="px-5 py-3 text-right text-destructive font-medium">{formatCurrency(m.outflow)}</td>
                      <td className={cn("px-5 py-3 text-right font-semibold", m.net >= 0 ? "text-success" : "text-destructive")}>
                        {formatCurrency(m.net)}
                      </td>
                      <td className="px-5 py-3 text-right text-muted-foreground">{m.txnCount}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/30 font-semibold">
                    <td className="px-5 py-3 text-foreground">Total</td>
                    <td className="px-5 py-3 text-right text-success">{formatCurrency(report.totals.inflow)}</td>
                    <td className="px-5 py-3 text-right text-destructive">{formatCurrency(report.totals.outflow)}</td>
                    <td className={cn("px-5 py-3 text-right", report.totals.net >= 0 ? "text-success" : "text-destructive")}>
                      {formatCurrency(report.totals.net)}
                    </td>
                    <td className="px-5 py-3 text-right text-muted-foreground">{report.totalCount}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Secondary: category breakdown (collapsed by default) */}
          <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden mb-6">
            <button
              onClick={() => setShowBreakdown((v) => !v)}
              className="w-full flex items-center justify-between px-5 py-3.5 text-sm font-semibold text-foreground"
            >
              Category Breakdown <span className="text-xs font-normal text-muted-foreground ml-1">(optional detail)</span>
              {showBreakdown ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            {showBreakdown && (
              <div className="px-5 pb-5 grid md:grid-cols-2 gap-6">
                <CategoryList title="Inflow" months={report.months} field="inflowBreakdown" tone="success" />
                <CategoryList title="Outflow" months={report.months} field="outflowBreakdown" tone="destructive" />
              </div>
            )}
          </div>

          {/* Credit Analysis */}
          <div className="bg-card rounded-xl border border-border shadow-sm p-5 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-foreground">Credit Analysis</h2>
              <span className={cn("text-xs font-semibold px-3 py-1 rounded-full border", ASSESSMENT_COLOR[report.credit.assessment])}>
                {report.credit.assessment} Capacity
              </span>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
              <CreditFigure label="Avg Monthly Inflow" value={formatCurrency(report.credit.avgMonthlyInflow)} />
              <CreditFigure label="Avg Monthly Outflow" value={formatCurrency(report.credit.avgMonthlyOutflow)} />
              <CreditFigure label="Avg Monthly Net Cash Flow" value={formatCurrency(report.credit.avgMonthlyNet)} />
              <CreditFigure label="Average Balance" value={formatCurrency(report.credit.avgBalance)} />
              <CreditFigure label="Lowest Balance" value={report.credit.lowestBalance !== null ? formatCurrency(report.credit.lowestBalance) : "—"} />
              <CreditFigure label="Existing Obligations (avg/mo)" value={formatCurrency(report.credit.existingObligations)} />
              <CreditFigure label="Income Consistency" value={`${report.credit.incomeConsistencyPct}%`} />
              <CreditFigure label="Cash-flow Stability" value={`${report.credit.cashflowStabilityPct}%`} sub={`${report.credit.positiveMonths}/${report.credit.monthsAnalyzed} months positive`} />
            </div>
            <div className="border-t border-border pt-4">
              <p className="text-xs font-medium text-muted-foreground mb-2">Supporting notes</p>
              <ul className="space-y-1.5">
                {report.credit.assessmentNotes.map((note, i) => (
                  <li key={i} className="text-sm text-foreground flex items-start gap-2">
                    <span className="w-1 h-1 rounded-full bg-muted-foreground mt-2 flex-shrink-0" />
                    {note}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Transactions */}
          <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-foreground">
                Transactions <span className="text-xs font-normal text-muted-foreground">({filteredTxns.length})</span>
              </h2>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search narration or category"
                    className="pl-8 pr-3 py-1.5 text-xs border border-border rounded-lg bg-background w-56"
                  />
                </div>
                <button
                  onClick={() => setReviewOnly((v) => !v)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border",
                    reviewOnly ? "bg-amber-100 text-amber-800 border-amber-200" : "border-border text-muted-foreground hover:bg-muted/40"
                  )}
                >
                  <AlertTriangle className="w-3.5 h-3.5" /> Needs review only
                </button>
              </div>
            </div>
            <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card z-10">
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left px-5 py-2.5 text-xs font-medium text-muted-foreground">Date</th>
                    <th className="text-left px-5 py-2.5 text-xs font-medium text-muted-foreground">Narration</th>
                    <th className="text-left px-5 py-2.5 text-xs font-medium text-muted-foreground">Category</th>
                    <th className="text-right px-5 py-2.5 text-xs font-medium text-muted-foreground">Debit</th>
                    <th className="text-right px-5 py-2.5 text-xs font-medium text-muted-foreground">Credit</th>
                    <th className="text-right px-5 py-2.5 text-xs font-medium text-muted-foreground">Balance</th>
                    <th className="text-center px-5 py-2.5 text-xs font-medium text-muted-foreground">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {txnLoading ? (
                    Array.from({ length: 6 }).map((_, i) => (
                      <tr key={i}>{Array.from({ length: 7 }).map((_, j) => (
                        <td key={j} className="px-5 py-2.5"><div className="h-3.5 bg-muted animate-pulse rounded" /></td>
                      ))}</tr>
                    ))
                  ) : filteredTxns.map((t) => (
                    <tr key={t.id} className={cn("hover:bg-muted/20", t.needs_review && !t.reviewed && "bg-amber-50/60")}>
                      <td className="px-5 py-2.5 text-muted-foreground whitespace-nowrap">{t.txn_date ? formatDate(t.txn_date) : "—"}</td>
                      <td className="px-5 py-2.5 text-foreground max-w-[280px] truncate" title={t.narration}>{t.narration}</td>
                      <td className="px-5 py-2.5">
                        <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{t.category}</span>
                      </td>
                      <td className="px-5 py-2.5 text-right text-destructive">{t.debit > 0 ? formatCurrency(t.debit) : "—"}</td>
                      <td className="px-5 py-2.5 text-right text-success">{t.credit > 0 ? formatCurrency(t.credit) : "—"}</td>
                      <td className="px-5 py-2.5 text-right text-muted-foreground">{t.balance !== null ? formatCurrency(t.balance) : "—"}</td>
                      <td className="px-5 py-2.5 text-center">
                        {t.needs_review ? (
                          <button
                            onClick={() => handleMarkReviewed(t)}
                            title={t.review_reason || "Flagged for review"}
                            className={cn(
                              "inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium",
                              t.reviewed ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"
                            )}
                          >
                            {t.reviewed ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                            {t.reviewed ? "Reviewed" : "Review"}
                          </button>
                        ) : (
                          <CheckCircle2 className="w-3.5 h-3.5 text-muted-foreground/50 mx-auto" />
                        )}
                      </td>
                    </tr>
                  ))}
                  {!txnLoading && filteredTxns.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-5 py-10 text-center text-muted-foreground">No transactions match this filter</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function CreditFigure({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-muted/30 rounded-lg p-3.5">
      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className="text-lg font-display font-bold text-foreground mt-0.5">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

function CategoryList({
  title, months, field, tone,
}: {
  title: string;
  months: { inflowBreakdown: Record<string, number>; outflowBreakdown: Record<string, number> }[];
  field: "inflowBreakdown" | "outflowBreakdown";
  tone: "success" | "destructive";
}) {
  const totals: Record<string, number> = {};
  months.forEach((m) => {
    Object.entries(m[field]).forEach(([cat, amt]) => {
      totals[cat] = (totals[cat] || 0) + amt;
    });
  });
  const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const max = entries.length ? entries[0][1] : 1;

  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground mb-3">{title}</p>
      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">No data</p>
      ) : (
        <div className="space-y-2.5">
          {entries.map(([cat, amt]) => (
            <div key={cat}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-foreground">{cat}</span>
                <span className={cn("font-medium", tone === "success" ? "text-success" : "text-destructive")}>{formatCurrency(amt)}</span>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className={cn("h-full rounded-full", tone === "success" ? "bg-success" : "bg-destructive")}
                  style={{ width: `${Math.max(4, (amt / max) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
