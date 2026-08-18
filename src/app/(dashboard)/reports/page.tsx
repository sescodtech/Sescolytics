"use client";

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency } from "@/lib/utils";
import { FileDown } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from "recharts";

const COLORS = ["hsl(212,75%,14%)", "hsl(42,67%,47%)", "hsl(152,52%,45%)", "hsl(0,75%,55%)", "hsl(207,65%,50%)"];

export default function ReportsPage() {
  const { data: loansByStatus } = useQuery({
    queryKey: ["report-loans-status"],
    queryFn: async () => {
      const { data } = await supabase.from("loans").select("status, outstanding_balance");
      if (!data) return [];
      const map: Record<string, { count: number; balance: number }> = {};
      data.forEach(l => {
        if (!map[l.status]) map[l.status] = { count: 0, balance: 0 };
        map[l.status].count++;
        map[l.status].balance += l.outstanding_balance;
      });
      return Object.entries(map).map(([name, v]) => ({ name: name.replace(/_/g, " "), ...v }));
    },
  });

  const { data: investmentsByStatus } = useQuery({
    queryKey: ["report-investments-status"],
    queryFn: async () => {
      const { data } = await supabase.from("investments").select("status, amount");
      if (!data) return [];
      const map: Record<string, { count: number; value: number }> = {};
      data.forEach(i => {
        if (!map[i.status]) map[i.status] = { count: 0, value: 0 };
        map[i.status].count++;
        map[i.status].value += i.amount;
      });
      return Object.entries(map).map(([name, v]) => ({ name: name.replace(/_/g, " "), ...v }));
    },
  });

  const { data: monthlyRepayments } = useQuery({
    queryKey: ["report-monthly"],
    queryFn: async () => {
      const { data } = await supabase
        .from("repayments")
        .select("amount, payment_date")
        .order("payment_date");
      if (!data) return [];
      const map: Record<string, number> = {};
      data.forEach(r => {
        const m = r.payment_date.slice(0, 7);
        map[m] = (map[m] || 0) + r.amount;
      });
      return Object.entries(map).slice(-12).map(([month, total]) => ({
        month: new Date(month + "-01").toLocaleDateString("en-NG", { month: "short", year: "2-digit" }),
        total,
      }));
    },
  });

  const { data: collectionBreakdown } = useQuery({
    queryKey: ["report-collection"],
    queryFn: async () => {
      const { data } = await supabase.from("loans").select("collection_status, outstanding_balance").neq("status", "completed");
      if (!data) return [];
      const map: Record<string, number> = {};
      data.forEach(l => { map[l.collection_status] = (map[l.collection_status] || 0) + l.outstanding_balance; });
      return Object.entries(map).map(([name, value]) => ({ name: name.replace(/_/g, " "), value }));
    },
  });

  const totalCollected = monthlyRepayments?.reduce((s, m) => s + m.total, 0) ?? 0;
  const totalInvestments = investmentsByStatus?.reduce((s, i) => s + i.value, 0) ?? 0;

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Reports & Analytics" description="Portfolio overview and performance metrics">
        <button onClick={() => window.print()}
          className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted/40 transition-colors">
          <FileDown className="w-4 h-4" /> Print / Save PDF
        </button>
      </PageHeader>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Loans", value: (loansByStatus?.reduce((s, l) => s + l.count, 0) ?? 0).toString() },
          { label: "Total Outstanding", value: formatCurrency(loansByStatus?.reduce((s, l) => s + l.balance, 0) ?? 0) },
          { label: "Total Collected", value: formatCurrency(totalCollected) },
          { label: "Investment Portfolio", value: formatCurrency(totalInvestments) },
        ].map(({ label, value }) => (
          <div key={label} className="bg-card border border-border rounded-xl p-4 shadow-sm">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">{label}</p>
            <p className="text-xl font-display font-bold text-foreground mt-1">{value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Monthly collections */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-foreground mb-4">Monthly Collections (12 months)</h2>
          {monthlyRepayments && monthlyRepayments.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={monthlyRepayments}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 18% 92%)" />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `₦${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => [`₦${v.toLocaleString()}`, "Collected"]} />
                <Bar dataKey="total" fill="hsl(212 75% 14%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="h-52 flex items-center justify-center text-muted-foreground text-sm">No repayment data</div>}
        </div>

        {/* Loans by status */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-foreground mb-4">Loans by Status</h2>
          {loansByStatus && loansByStatus.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={loansByStatus} dataKey="count" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, count }) => `${name}: ${count}`} labelLine={false}>
                  {loansByStatus.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => [v, "Loans"]} />
              </PieChart>
            </ResponsiveContainer>
          ) : <div className="h-52 flex items-center justify-center text-muted-foreground text-sm">No data</div>}
        </div>

        {/* Collection status breakdown */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-foreground mb-4">Outstanding by Collection Status</h2>
          {collectionBreakdown && collectionBreakdown.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={collectionBreakdown} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 18% 92%)" />
                <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `₦${(v / 1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={100} />
                <Tooltip formatter={(v: number) => [`₦${v.toLocaleString()}`, "Outstanding"]} />
                <Bar dataKey="value" fill="hsl(42 67% 47%)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="h-52 flex items-center justify-center text-muted-foreground text-sm">No data</div>}
        </div>

        {/* Investments */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-foreground mb-4">Investment Portfolio Breakdown</h2>
          {investmentsByStatus && investmentsByStatus.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={investmentsByStatus} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80}>
                  {investmentsByStatus.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => [`₦${v.toLocaleString()}`, "Value"]} />
              </PieChart>
            </ResponsiveContainer>
          ) : <div className="h-52 flex items-center justify-center text-muted-foreground text-sm">No data</div>}
        </div>
      </div>
    </div>
  );
}
