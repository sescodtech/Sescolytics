"use client";

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { ensureStatusesFresh } from "@/lib/statusRefresh";
import { StatCard } from "@/components/StatCard";
import { formatCurrency, formatDate, getLoanStatusColor, getInvestmentStatusColor, formatStatus } from "@/lib/utils";
import { StatusBadge } from "@/components/StatusBadge";
import {
  CreditCard, TrendingUp, AlertTriangle, CheckCircle2,
  Users, Clock, DollarSign, Activity
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from "recharts";

export default function DashboardPage() {
  const { data: loanStats } = useQuery({
    queryKey: ["dashboard-loan-stats"],
    queryFn: async () => {
      await ensureStatusesFresh();
      const { data } = await supabase.from("loans").select("status, outstanding_balance, total_amount, amount_paid");
      if (!data) return null;
      const total = data.length;
      const overdue = data.filter(l => l.status === "overdue").length;
      const dueToday = data.filter(l => l.status === "due_today").length;
      const completed = data.filter(l => l.status === "completed").length;
      const totalOutstanding = data.reduce((s, l) => s + l.outstanding_balance, 0);
      const totalDisbursed = data.reduce((s, l) => s + l.total_amount, 0);
      return { total, overdue, dueToday, completed, totalOutstanding, totalDisbursed };
    },
  });

  const { data: investmentStats } = useQuery({
    queryKey: ["dashboard-investment-stats"],
    queryFn: async () => {
      const { data } = await supabase.from("investments").select("status, amount, interest_rate");
      if (!data) return null;
      const active = data.filter(i => i.status === "active").length;
      const matured = data.filter(i => i.status === "matured").length;
      const maturingSoon = data.filter(i => i.status === "maturing_soon").length;
      const totalValue = data.reduce((s, i) => s + i.amount, 0);
      return { active, matured, maturingSoon, totalValue };
    },
  });

  const { data: recentLoans } = useQuery({
    queryKey: ["dashboard-recent-loans"],
    queryFn: async () => {
      const { data } = await supabase
        .from("loans")
        .select("id, loan_number, customer_name, outstanding_balance, status, due_date")
        .order("created_at", { ascending: false })
        .limit(8);
      return data ?? [];
    },
  });

  const { data: recentInvestments } = useQuery({
    queryKey: ["dashboard-recent-investments"],
    queryFn: async () => {
      const { data } = await supabase
        .from("investments")
        .select("id, investment_number, customer_id, amount, status, maturity_date, interest_rate")
        .order("created_at", { ascending: false })
        .limit(5);
      return data ?? [];
    },
  });

  const { data: customerCount } = useQuery({
    queryKey: ["dashboard-customers"],
    queryFn: async () => {
      const { count } = await supabase.from("customers").select("*", { count: "exact", head: true });
      return count ?? 0;
    },
  });

  const { data: attentionLoans } = useQuery({
    queryKey: ["dashboard-attention-loans"],
    queryFn: async () => {
      const { data } = await supabase
        .from("loans")
        .select("id, loan_number, customer_name, outstanding_balance, status, due_date")
        .in("status", ["overdue", "due_today", "due_tomorrow"])
        .neq("collection_status", "fully_paid")
        .order("outstanding_balance", { ascending: false });
      return data ?? [];
    },
  });

  const { data: repaymentData } = useQuery({
    queryKey: ["dashboard-repayments"],
    queryFn: async () => {
      const { data } = await supabase
        .from("repayments")
        .select("amount, payment_date")
        .order("payment_date", { ascending: true });
      if (!data) return [];
      // Group by month
      const byMonth: Record<string, number> = {};
      data.forEach(r => {
        const month = r.payment_date.slice(0, 7);
        byMonth[month] = (byMonth[month] || 0) + r.amount;
      });
      return Object.entries(byMonth).slice(-6).map(([month, total]) => ({
        month: new Date(month + "-01").toLocaleDateString("en-NG", { month: "short", year: "2-digit" }),
        total,
      }));
    },
  });

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-display font-bold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {new Date().toLocaleDateString("en-NG", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          </p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 bg-success/10 rounded-full">
          <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
          <span className="text-xs font-medium text-success">Live</span>
        </div>
      </div>

      {/* Needs attention — real bulk-reminder entry point, not just a count */}
      {attentionLoans && attentionLoans.length > 0 && (
        <div className="bg-card rounded-xl border border-amber-200 bg-amber-50/50 p-5 shadow-sm flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">
                {attentionLoans.length} loan{attentionLoans.length > 1 ? "s" : ""} need{attentionLoans.length === 1 ? "s" : ""} attention today
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Overdue, due today, or due tomorrow · {formatCurrency(attentionLoans.reduce((s, l) => s + l.outstanding_balance, 0))} outstanding
              </p>
            </div>
          </div>
          <a
            href={`/reminders?loanIds=${attentionLoans.map((l) => l.id).join(",")}`}
            className="flex items-center gap-2 px-4 py-2 brand-gradient text-white rounded-lg text-sm font-medium hover:opacity-90 flex-shrink-0"
          >
            Send Reminders
          </a>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Loans"
          value={loanStats?.total ?? "—"}
          subtitle={`${loanStats?.completed ?? 0} completed`}
          icon={CreditCard}
          iconColor="text-primary"
          iconBg="bg-primary/10"
        />
        <StatCard
          title="Outstanding"
          value={loanStats ? formatCurrency(loanStats.totalOutstanding) : "—"}
          subtitle="Total portfolio at risk"
          icon={DollarSign}
          iconColor="text-gold"
          iconBg="bg-gold/10"
        />
        <StatCard
          title="Overdue Loans"
          value={loanStats?.overdue ?? "—"}
          subtitle={`${loanStats?.dueToday ?? 0} due today`}
          icon={AlertTriangle}
          iconColor="text-destructive"
          iconBg="bg-destructive/10"
        />
        <StatCard
          title="Investments"
          value={investmentStats?.active ?? "—"}
          subtitle={`${investmentStats?.maturingSoon ?? 0} maturing soon`}
          icon={TrendingUp}
          iconColor="text-success"
          iconBg="bg-success/10"
        />
      </div>

      {/* Second row stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Customers"
          value={customerCount ?? "—"}
          icon={Users}
          iconColor="text-purple-600"
          iconBg="bg-purple-100"
        />
        <StatCard
          title="Total Disbursed"
          value={loanStats ? formatCurrency(loanStats.totalDisbursed) : "—"}
          icon={Activity}
          iconColor="text-blue-600"
          iconBg="bg-blue-100"
        />
        <StatCard
          title="Investment Value"
          value={investmentStats ? formatCurrency(investmentStats.totalValue) : "—"}
          icon={CheckCircle2}
          iconColor="text-emerald-600"
          iconBg="bg-emerald-100"
        />
        <StatCard
          title="Matured"
          value={investmentStats?.matured ?? "—"}
          subtitle="Awaiting renewal/closure"
          icon={Clock}
          iconColor="text-amber-600"
          iconBg="bg-amber-100"
        />
      </div>

      {/* Charts + Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Repayment chart */}
        <div className="lg:col-span-2 bg-card rounded-xl border border-border p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-foreground mb-4">Monthly Collections</h2>
          {repaymentData && repaymentData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={repaymentData}>
                <defs>
                  <linearGradient id="colGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(212 75% 14%)" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="hsl(212 75% 14%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 18% 92%)" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₦${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => [`₦${v.toLocaleString()}`, "Collections"]} />
                <Area type="monotone" dataKey="total" stroke="hsl(212 75% 14%)" fill="url(#colGrad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
              No repayment data yet
            </div>
          )}
        </div>

        {/* Recent investments */}
        <div className="bg-card rounded-xl border border-border p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-foreground mb-4">Recent Investments</h2>
          <div className="space-y-3">
            {recentInvestments?.map(inv => (
              <div key={inv.id} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-foreground truncate">{inv.investment_number}</p>
                  <p className="text-xs text-muted-foreground">{formatCurrency(inv.amount)} · {inv.interest_rate}%</p>
                </div>
                <StatusBadge status={inv.status} colorClass={getInvestmentStatusColor(inv.status)} />
              </div>
            ))}
            {!recentInvestments?.length && (
              <p className="text-xs text-muted-foreground text-center py-6">No investments yet</p>
            )}
          </div>
        </div>
      </div>

      {/* Recent Loans table */}
      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Recent Loans</h2>
          <a href="/loans" className="text-xs font-medium text-primary hover:underline">View all →</a>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">Loan #</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">Customer</th>
                <th className="text-right px-5 py-3 text-xs font-medium text-muted-foreground">Balance</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">Due Date</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {recentLoans?.map(loan => (
                <tr key={loan.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-5 py-3 font-mono text-xs text-foreground">{loan.loan_number}</td>
                  <td className="px-5 py-3 font-medium text-foreground">{loan.customer_name}</td>
                  <td className="px-5 py-3 text-right font-medium text-foreground">{formatCurrency(loan.outstanding_balance)}</td>
                  <td className="px-5 py-3 text-muted-foreground">{formatDate(loan.due_date)}</td>
                  <td className="px-5 py-3">
                    <StatusBadge status={loan.status} colorClass={getLoanStatusColor(loan.status)} />
                  </td>
                </tr>
              ))}
              {!recentLoans?.length && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-muted-foreground text-sm">No loans yet</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
