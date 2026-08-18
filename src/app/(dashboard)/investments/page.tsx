"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { formatCurrency, formatDate, getInvestmentStatusColor } from "@/lib/utils";
import { Search, Plus, X, RefreshCw, FileDown } from "lucide-react";
import { toast } from "sonner";
import type { Tables } from "@/lib/supabase/types";

type Investment = Tables<"investments"> & {
  customers?: { full_name: string; phone: string } | null;
};

// ── Add Investment Modal ─────────────────────────────────────
function AddInvestmentModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    investment_number: "", customer_name: "", customer_phone: "",
    amount: "", interest_rate: "", duration_days: "",
    start_date: new Date().toISOString().slice(0, 10),
    maturity_date: "", notes: "",
  });

  const { data: customers = [] } = useQuery({
    queryKey: ["customers-list"],
    queryFn: async () => {
      const { data } = await supabase.from("customers").select("id, full_name, phone").eq("status", "active").order("full_name");
      return data ?? [];
    },
  });

  const set = (k: string, v: string) => {
    const next = { ...form, [k]: v };
    // Auto-calc maturity date from start_date + duration_days
    if ((k === "start_date" || k === "duration_days") && next.start_date && next.duration_days) {
      const start = new Date(next.start_date);
      start.setDate(start.getDate() + parseInt(next.duration_days));
      next.maturity_date = start.toISOString().slice(0, 10);
    }
    setForm(next);
  };

  const mutation = useMutation({
    mutationFn: async () => {
      if (!form.investment_number || !form.customer_name || !form.amount || !form.interest_rate || !form.maturity_date)
        throw new Error("Investment number, customer, amount, rate and maturity date are required");

      // Find or create customer
      let customerId: string | null = null;
      const existing = customers.find(c =>
        c.full_name.toLowerCase() === form.customer_name.toLowerCase()
      );
      if (existing) {
        customerId = existing.id;
      } else {
        const { data: newCust, error: custErr } = await supabase
          .from("customers")
          .insert({
            customer_code: `CUS-${Date.now()}`,
            full_name: form.customer_name,
            phone: form.customer_phone || "N/A",
            date_joined: new Date().toISOString().slice(0, 10),
            status: "active",
          })
          .select("id")
          .single();
        if (custErr) throw custErr;
        customerId = newCust?.id ?? null;
      }
      if (!customerId) throw new Error("Could not resolve customer");

      const today = new Date().toISOString().slice(0, 10);
      const daysToMaturity = Math.ceil(
        (new Date(form.maturity_date).getTime() - new Date(today).getTime()) / 86400000
      );
      const status = daysToMaturity < 0 ? "matured" : daysToMaturity <= 7 ? "maturing_soon" : "active";

      const { error } = await supabase.from("investments").insert({
        investment_number: form.investment_number,
        customer_id: customerId,
        amount: parseFloat(form.amount),
        interest_rate: parseFloat(form.interest_rate),
        duration_days: parseInt(form.duration_days) || Math.ceil((new Date(form.maturity_date).getTime() - new Date(form.start_date).getTime()) / 86400000),
        start_date: form.start_date,
        maturity_date: form.maturity_date,
        status: status as Tables<"investments">["status"],
        notes: form.notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Investment record added");
      queryClient.invalidateQueries({ queryKey: ["investments"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-investment-stats"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-card rounded-xl shadow-xl w-full max-w-lg border border-border flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <div>
            <h2 className="font-semibold text-foreground">Add Investment Record</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Enter investment details from your CBS</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium mb-1.5">Investment Number *</label>
              <input type="text" value={form.investment_number} onChange={e => set("investment_number", e.target.value)}
                placeholder="e.g. INV-2024-001"
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>

            <div className="col-span-2">
              <label className="block text-sm font-medium mb-1.5">Customer Name *</label>
              <input type="text" value={form.customer_name}
                onChange={e => set("customer_name", e.target.value)}
                list="customers-list"
                placeholder="Type to search existing customers or enter new name"
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
              <datalist id="customers-list">
                {customers.map(c => <option key={c.id} value={c.full_name} />)}
              </datalist>
              {customers.find(c => c.full_name.toLowerCase() === form.customer_name.toLowerCase()) ? (
                <p className="text-xs text-success mt-1">✓ Existing customer found</p>
              ) : form.customer_name.length > 2 ? (
                <p className="text-xs text-amber-600 mt-1">New customer will be created</p>
              ) : null}
            </div>

            <div className="col-span-2">
              <label className="block text-sm font-medium mb-1.5">Customer Phone</label>
              <input type="tel" value={form.customer_phone} onChange={e => set("customer_phone", e.target.value)}
                placeholder="e.g. 08012345678"
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5">Amount (₦) *</label>
              <input type="number" value={form.amount} onChange={e => set("amount", e.target.value)}
                placeholder="0.00"
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Interest Rate (%) *</label>
              <input type="number" value={form.interest_rate} onChange={e => set("interest_rate", e.target.value)}
                placeholder="e.g. 12.5" step="0.1"
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5">Start Date</label>
              <input type="date" value={form.start_date} onChange={e => set("start_date", e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Duration (days)</label>
              <input type="number" value={form.duration_days} onChange={e => set("duration_days", e.target.value)}
                placeholder="e.g. 365 (auto-sets maturity)"
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>

            <div className="col-span-2">
              <label className="block text-sm font-medium mb-1.5">Maturity Date *</label>
              <input type="date" value={form.maturity_date} onChange={e => set("maturity_date", e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
              {form.amount && form.interest_rate && form.maturity_date && form.start_date && (
                <p className="text-xs text-success mt-1">
                  Expected interest: {formatCurrency(
                    parseFloat(form.amount) * parseFloat(form.interest_rate) / 100 *
                    (Math.ceil((new Date(form.maturity_date).getTime() - new Date(form.start_date).getTime()) / 86400000) / 365)
                  )}
                </p>
              )}
            </div>

            <div className="col-span-2">
              <label className="block text-sm font-medium mb-1.5">Notes (optional)</label>
              <textarea value={form.notes} onChange={e => set("notes", e.target.value)} rows={2}
                placeholder="Any remarks..."
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none" />
            </div>
          </div>
        </div>
        <div className="flex gap-3 px-6 py-4 border-t border-border flex-shrink-0">
          <button onClick={onClose} className="flex-1 py-2.5 border border-border rounded-lg text-sm font-medium hover:bg-muted/40">Cancel</button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending}
            className="flex-1 py-2.5 brand-gradient text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-60">
            {mutation.isPending ? "Saving..." : "Add Investment"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Renew Modal ──────────────────────────────────────────────
function RenewModal({ inv, onClose }: { inv: Investment; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState(String(inv.amount));
  const [rate, setRate] = useState(String(inv.interest_rate));
  const [duration, setDuration] = useState(String(inv.duration_days));

  const newMaturity = (() => {
    const d = new Date();
    d.setDate(d.getDate() + parseInt(duration || "0"));
    return d.toISOString().slice(0, 10);
  })();

  const mutation = useMutation({
    mutationFn: async () => {
      const startDate = new Date().toISOString().slice(0, 10);
      const maturityDate = newMaturity;
      const invNumber = `${inv.investment_number}-R${Date.now().toString().slice(-4)}`;
      const { error: e1 } = await supabase.from("investments").update({ status: "renewed" }).eq("id", inv.id);
      if (e1) throw e1;
      const { error: e2 } = await supabase.from("investments").insert({
        customer_id: inv.customer_id,
        investment_number: invNumber,
        amount: parseFloat(amount),
        interest_rate: parseFloat(rate),
        duration_days: parseInt(duration),
        start_date: startDate,
        maturity_date: maturityDate,
        status: "active",
        renewed_from: inv.id,
        branch_id: inv.branch_id,
      });
      if (e2) throw e2;
    },
    onSuccess: () => {
      toast.success("Investment renewed successfully");
      queryClient.invalidateQueries({ queryKey: ["investments"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-card rounded-xl shadow-xl w-full max-w-md border border-border">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="font-semibold text-foreground">Renew Investment</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{inv.investment_number}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="bg-muted/40 rounded-lg p-3 text-sm grid grid-cols-2 gap-2">
            <div><span className="text-muted-foreground">Current amount:</span> <span className="font-medium">{formatCurrency(inv.amount)}</span></div>
            <div><span className="text-muted-foreground">Rate:</span> <span className="font-medium">{inv.interest_rate}%</span></div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">New Amount (₦)</label>
            <input type="number" value={amount} onChange={e => setAmount(e.target.value)}
              className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1.5">Interest Rate (%)</label>
              <input type="number" value={rate} onChange={e => setRate(e.target.value)} step="0.1"
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Duration (days)</label>
              <input type="number" value={duration} onChange={e => setDuration(e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
          </div>
          {duration && (
            <p className="text-xs text-success">New maturity date: <span className="font-medium">{formatDate(newMaturity)}</span></p>
          )}
        </div>
        <div className="flex gap-3 px-6 py-4 border-t border-border">
          <button onClick={onClose} className="flex-1 py-2.5 border border-border rounded-lg text-sm font-medium hover:bg-muted/40">Cancel</button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending}
            className="flex-1 py-2.5 brand-gradient text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-60">
            {mutation.isPending ? "Renewing..." : "Renew Investment"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Export CSV ───────────────────────────────────────────────
function exportInvestments(investments: Investment[]) {
  const headers = ["Investment #","Customer","Amount","Rate (%)","Duration (days)","Start Date","Maturity Date","Status","Notes"];
  const rows = investments.map(i => [
    i.investment_number,
    (i.customers as { full_name: string } | null)?.full_name ?? "",
    i.amount, i.interest_rate, i.duration_days,
    i.start_date, i.maturity_date, i.status, i.notes ?? "",
  ]);
  const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `investments_export_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast.success("Investments exported to CSV");
}

// ── Main Page ────────────────────────────────────────────────
export default function InvestmentsPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [renewTarget, setRenewTarget] = useState<Investment | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const { data: investments = [], isLoading } = useQuery({
    queryKey: ["investments"],
    queryFn: async () => {
      const { data } = await supabase
        .from("investments")
        .select("*, customers:customer_id(full_name, phone)")
        .order("created_at", { ascending: false });
      return (data ?? []) as unknown as Investment[];
    },
  });

  const filtered = investments.filter(i => {
    const name = (i.customers as { full_name: string } | null)?.full_name ?? "";
    const matchSearch = name.toLowerCase().includes(search.toLowerCase()) ||
      i.investment_number.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || i.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const totalActive = investments.filter(i => i.status === "active").reduce((s, i) => s + i.amount, 0);
  const maturingSoon = investments.filter(i => i.status === "maturing_soon").length;
  const matured = investments.filter(i => i.status === "matured").length;

  return (
    <div className="p-6">
      <PageHeader title="Investments" description={`${investments.length} total · ${formatCurrency(totalActive)} active portfolio`}>
        <button onClick={() => exportInvestments(filtered)}
          className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted/40 transition-colors">
          <FileDown className="w-4 h-4" /> Export CSV
        </button>
        <button onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-4 py-2 brand-gradient text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity">
          <Plus className="w-4 h-4" /> Add Investment
        </button>
      </PageHeader>

      {/* Alert banners */}
      {(maturingSoon > 0 || matured > 0) && (
        <div className="flex flex-wrap gap-3 mb-5">
          {matured > 0 && (
            <div className="flex items-center gap-2 px-4 py-2.5 bg-blue-50 border border-blue-200 rounded-lg text-sm">
              <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
              <span className="text-blue-800"><span className="font-semibold">{matured}</span> matured — awaiting renewal or closure</span>
            </div>
          )}
          {maturingSoon > 0 && (
            <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-lg text-sm">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              <span className="text-amber-800"><span className="font-semibold">{maturingSoon}</span> maturing within 7 days</span>
            </div>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by customer name or investment number..."
            className="w-full pl-9 pr-4 py-2.5 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 bg-card" />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="border border-border rounded-lg px-3 py-2.5 text-sm bg-card min-w-36 focus:outline-none focus:ring-2 focus:ring-primary/30">
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="maturing_soon">Maturing Soon</option>
          <option value="matured">Matured</option>
          <option value="renewed">Renewed</option>
          <option value="closed">Closed</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">Inv #</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">Customer</th>
                <th className="text-right px-5 py-3 text-xs font-medium text-muted-foreground">Amount</th>
                <th className="text-right px-5 py-3 text-xs font-medium text-muted-foreground">Rate</th>
                <th className="text-right px-5 py-3 text-xs font-medium text-muted-foreground">Interest</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">Start</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">Matures</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">Status</th>
                <th className="text-center px-5 py-3 text-xs font-medium text-muted-foreground">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>{Array.from({ length: 9 }).map((_, j) => (
                    <td key={j} className="px-5 py-3"><div className="h-4 bg-muted animate-pulse rounded" /></td>
                  ))}</tr>
                ))
              ) : filtered.map(inv => {
                const customer = inv.customers as { full_name: string } | null;
                const interest = inv.amount * inv.interest_rate / 100 * (inv.duration_days / 365);
                const isAlert = inv.status === "matured" || inv.status === "maturing_soon";
                return (
                  <tr key={inv.id} className={`hover:bg-muted/20 transition-colors ${isAlert ? "bg-amber-50/20" : ""}`}>
                    <td className="px-5 py-3 font-mono text-xs font-medium text-foreground">{inv.investment_number}</td>
                    <td className="px-5 py-3 font-medium text-foreground">{customer?.full_name ?? "—"}</td>
                    <td className="px-5 py-3 text-right font-semibold text-foreground">{formatCurrency(inv.amount)}</td>
                    <td className="px-5 py-3 text-right text-foreground">{inv.interest_rate}%</td>
                    <td className="px-5 py-3 text-right text-success font-medium">{formatCurrency(interest)}</td>
                    <td className="px-5 py-3 text-muted-foreground">{formatDate(inv.start_date)}</td>
                    <td className="px-5 py-3 text-muted-foreground">{formatDate(inv.maturity_date)}</td>
                    <td className="px-5 py-3"><StatusBadge status={inv.status} colorClass={getInvestmentStatusColor(inv.status)} /></td>
                    <td className="px-5 py-3 text-center">
                      {(inv.status === "matured" || inv.status === "maturing_soon" || inv.status === "active") && (
                        <button onClick={() => setRenewTarget(inv)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors">
                          <RefreshCw className="w-3 h-3" /> Renew
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!isLoading && filtered.length === 0 && (
                <tr><td colSpan={9} className="px-5 py-10 text-center text-muted-foreground">
                  {investments.length === 0 ? "No investments yet — click \"Add Investment\" or use Imports to upload a CSV" : "No investments match your search"}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-3 border-t border-border text-xs text-muted-foreground">
          Showing {filtered.length} of {investments.length} investments
        </div>
      </div>

      {showAdd && <AddInvestmentModal onClose={() => setShowAdd(false)} />}
      {renewTarget && <RenewModal inv={renewTarget} onClose={() => setRenewTarget(null)} />}
    </div>
  );
}
