"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { formatCurrency, formatDate, getLoanStatusColor, getCollectionStatusColor } from "@/lib/utils";
import { Search, Plus, X, DollarSign, FileDown } from "lucide-react";
import { toast } from "sonner";
import type { Tables } from "@/lib/supabase/types";
import { resolveOrCreateCustomer } from "@/lib/imports/customerResolver";

type Loan = Tables<"loans">;

// ── Add Loan Modal ──────────────────────────────────────────
function AddLoanModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    loan_number: "", customer_name: "", customer_phone: "",
    principal_amount: "", interest_amount: "", total_amount: "",
    outstanding_balance: "", amount_paid: "0",
    start_date: new Date().toISOString().slice(0, 10),
    due_date: "", repayment_frequency: "monthly",
  });

  const set = (k: string, v: string) => {
    const next = { ...form, [k]: v };
    // Auto-calculate total and outstanding
    if (k === "principal_amount" || k === "interest_amount") {
      const p = parseFloat(next.principal_amount) || 0;
      const i = parseFloat(next.interest_amount) || 0;
      next.total_amount = String(p + i);
      next.outstanding_balance = String(p + i - (parseFloat(next.amount_paid) || 0));
    }
    setForm(next);
  };

  const mutation = useMutation({
    mutationFn: async () => {
      if (!form.loan_number || !form.customer_name || !form.principal_amount || !form.due_date)
        throw new Error("Loan number, customer name, principal and due date are required");
      const principal = parseFloat(form.principal_amount);
      const interest = parseFloat(form.interest_amount) || 0;
      const total = parseFloat(form.total_amount) || principal + interest;
      const paid = parseFloat(form.amount_paid) || 0;
      const outstanding = parseFloat(form.outstanding_balance) || total - paid;

      // Link this loan to a real customer record (matching on phone/name,
      // creating one if none exists) so features that depend on customer
      // contact info — like emailed reminders — actually have something to
      // join against. Without this, the loan only carries free-text
      // name/phone and reminders silently treat the customer as having no
      // email on file, even if one exists.
      const resolution = await resolveOrCreateCustomer(
        { name: form.customer_name, phone: form.customer_phone || undefined },
        form.loan_number
      );

      const { error } = await supabase.from("loans").insert({
        loan_number: form.loan_number,
        customer_id: resolution?.customerId ?? null,
        customer_name: form.customer_name,
        customer_phone: form.customer_phone || null,
        principal_amount: principal,
        interest_amount: interest,
        total_amount: total,
        amount_paid: paid,
        outstanding_balance: outstanding,
        start_date: form.start_date,
        due_date: form.due_date,
        repayment_frequency: form.repayment_frequency as Tables<"loans">["repayment_frequency"],
        status: outstanding <= 0 ? "completed" : "active",
        collection_status: paid > 0 && outstanding > 0 ? "partially_paid" : "current",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Loan record added successfully");
      queryClient.invalidateQueries({ queryKey: ["loans"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-loan-stats"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const fields = [
    { label: "Loan Number *", key: "loan_number", type: "text", placeholder: "e.g. LN-2024-001" },
    { label: "Customer Name *", key: "customer_name", type: "text", placeholder: "e.g. Amaka Okafor" },
    { label: "Phone", key: "customer_phone", type: "tel", placeholder: "e.g. 08012345678" },
    { label: "Principal Amount (₦) *", key: "principal_amount", type: "number", placeholder: "0.00" },
    { label: "Interest Amount (₦)", key: "interest_amount", type: "number", placeholder: "0.00" },
    { label: "Total Amount (₦)", key: "total_amount", type: "number", placeholder: "Auto-calculated" },
    { label: "Amount Paid (₦)", key: "amount_paid", type: "number", placeholder: "0.00" },
    { label: "Outstanding Balance (₦)", key: "outstanding_balance", type: "number", placeholder: "Auto-calculated" },
    { label: "Start Date *", key: "start_date", type: "date", placeholder: "" },
    { label: "Due Date *", key: "due_date", type: "date", placeholder: "" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-card rounded-xl shadow-xl w-full max-w-lg border border-border flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <div>
            <h2 className="font-semibold text-foreground">Add Loan Record</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Enter loan details from your CBS</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-2 gap-4">
            {fields.map(({ label, key, type, placeholder }) => (
              <div key={key} className={key === "loan_number" || key === "customer_name" ? "col-span-2" : ""}>
                <label className="block text-sm font-medium mb-1.5">{label}</label>
                <input type={type} value={(form as Record<string,string>)[key]}
                  onChange={e => set(key, e.target.value)}
                  placeholder={placeholder}
                  className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
            ))}
            <div className="col-span-2">
              <label className="block text-sm font-medium mb-1.5">Repayment Frequency</label>
              <select value={form.repayment_frequency} onChange={e => set("repayment_frequency", e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="biweekly">Bi-weekly</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="bullet">Bullet (Lump Sum)</option>
              </select>
            </div>
          </div>
        </div>
        <div className="flex gap-3 px-6 py-4 border-t border-border flex-shrink-0">
          <button onClick={onClose} className="flex-1 py-2.5 border border-border rounded-lg text-sm font-medium hover:bg-muted/40">Cancel</button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending}
            className="flex-1 py-2.5 brand-gradient text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-60">
            {mutation.isPending ? "Saving..." : "Add Loan"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Record Payment Modal ─────────────────────────────────────
function RecordPaymentModal({ loan, onClose }: { loan: Loan; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      const amt = parseFloat(amount);
      if (!amt || amt <= 0) throw new Error("Enter a valid amount");
      if (amt > loan.outstanding_balance) throw new Error("Amount exceeds outstanding balance");
      const { error } = await supabase.from("repayments").insert({
        loan_id: loan.id, amount: amt, method,
        reference: reference || null, notes: notes || null,
        payment_date: new Date().toISOString().slice(0, 10),
      });
      if (error) throw error;
      const newBalance = Math.max(0, loan.outstanding_balance - amt);
      await supabase.from("loans").update({
        amount_paid: loan.amount_paid + amt,
        outstanding_balance: newBalance,
        status: newBalance === 0 ? "completed" : loan.status,
        collection_status: newBalance === 0 ? "fully_paid" : "partially_paid",
      }).eq("id", loan.id);
    },
    onSuccess: () => {
      toast.success("Payment recorded successfully");
      queryClient.invalidateQueries({ queryKey: ["loans"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-loan-stats"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-card rounded-xl shadow-xl w-full max-w-md border border-border">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="font-semibold text-foreground">Record Payment</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{loan.loan_number} · {loan.customer_name}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="bg-muted/40 rounded-lg p-3 grid grid-cols-2 gap-2 text-sm">
            <div><span className="text-muted-foreground">Principal:</span> <span className="font-medium">{formatCurrency(loan.principal_amount)}</span></div>
            <div><span className="text-muted-foreground">Paid so far:</span> <span className="font-medium text-success">{formatCurrency(loan.amount_paid)}</span></div>
            <div className="col-span-2"><span className="text-muted-foreground">Outstanding:</span> <span className="font-bold text-destructive ml-1">{formatCurrency(loan.outstanding_balance)}</span></div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">Amount (₦) *</label>
            <input type="number" value={amount} onChange={e => setAmount(e.target.value)}
              placeholder="0.00" max={loan.outstanding_balance}
              className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">Payment Method</label>
            <select value={method} onChange={e => setMethod(e.target.value)}
              className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
              <option value="cash">Cash</option>
              <option value="transfer">Bank Transfer</option>
              <option value="pos">POS</option>
              <option value="cheque">Cheque</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">Reference (optional)</label>
            <input type="text" value={reference} onChange={e => setReference(e.target.value)}
              placeholder="Transaction reference / teller number"
              className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">Notes (optional)</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none" />
          </div>
        </div>
        <div className="flex gap-3 px-6 py-4 border-t border-border">
          <button onClick={onClose} className="flex-1 py-2.5 border border-border rounded-lg text-sm font-medium hover:bg-muted/40">Cancel</button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending}
            className="flex-1 py-2.5 brand-gradient text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-60">
            {mutation.isPending ? "Saving..." : "Record Payment"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Export to CSV ────────────────────────────────────────────
function exportToCSV(loans: Loan[]) {
  const headers = ["Loan Number","Customer Name","Phone","Principal","Interest","Total","Amount Paid","Outstanding","Start Date","Due Date","Status","Collection Status","Repayment Frequency"];
  const rows = loans.map(l => [
    l.loan_number, l.customer_name, l.customer_phone ?? "",
    l.principal_amount, l.interest_amount, l.total_amount,
    l.amount_paid, l.outstanding_balance,
    l.start_date, l.due_date, l.status, l.collection_status, l.repayment_frequency,
  ]);
  const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `loans_export_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast.success("Loans exported to CSV");
}

// ── Main Page ────────────────────────────────────────────────
export default function LoansPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedLoan, setSelectedLoan] = useState<Loan | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const { data: loans = [], isLoading } = useQuery({
    queryKey: ["loans"],
    queryFn: async () => {
      const { data } = await supabase.from("loans").select("*").order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const filtered = loans.filter(l => {
    const matchSearch =
      l.customer_name.toLowerCase().includes(search.toLowerCase()) ||
      l.loan_number.toLowerCase().includes(search.toLowerCase()) ||
      (l.customer_phone ?? "").includes(search);
    const matchStatus = statusFilter === "all" || l.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const overdueCount = loans.filter(l => l.status === "overdue").length;
  const dueTodayCount = loans.filter(l => l.status === "due_today").length;

  return (
    <div className="p-6">
      <PageHeader title="Loans" description={`${loans.length} total loans`}>
        <button onClick={() => exportToCSV(filtered)}
          className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted/40 transition-colors">
          <FileDown className="w-4 h-4" /> Export CSV
        </button>
        <button onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-4 py-2 brand-gradient text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity">
          <Plus className="w-4 h-4" /> Add Loan
        </button>
      </PageHeader>

      {/* Alert banners */}
      {(overdueCount > 0 || dueTodayCount > 0) && (
        <div className="flex flex-wrap gap-3 mb-5">
          {overdueCount > 0 && (
            <div className="flex items-center gap-2 px-4 py-2.5 bg-red-50 border border-red-200 rounded-lg text-sm">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-red-800"><span className="font-semibold">{overdueCount}</span> overdue loan{overdueCount > 1 ? "s" : ""}</span>
            </div>
          )}
          {dueTodayCount > 0 && (
            <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-lg text-sm">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              <span className="text-amber-800"><span className="font-semibold">{dueTodayCount}</span> due today</span>
            </div>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, loan number, or phone..."
            className="w-full pl-9 pr-4 py-2.5 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 bg-card" />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 bg-card min-w-36">
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="due_today">Due Today</option>
          <option value="due_tomorrow">Due Tomorrow</option>
          <option value="overdue">Overdue</option>
          <option value="completed">Completed</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">Loan #</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">Customer</th>
                <th className="text-right px-5 py-3 text-xs font-medium text-muted-foreground">Principal</th>
                <th className="text-right px-5 py-3 text-xs font-medium text-muted-foreground">Paid</th>
                <th className="text-right px-5 py-3 text-xs font-medium text-muted-foreground">Outstanding</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">Due Date</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">Status</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">Collection</th>
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
              ) : filtered.map(loan => (
                <tr key={loan.id} className={`hover:bg-muted/20 transition-colors ${loan.status === "overdue" ? "bg-red-50/30" : loan.status === "due_today" ? "bg-amber-50/30" : ""}`}>
                  <td className="px-5 py-3 font-mono text-xs text-foreground font-medium">{loan.loan_number}</td>
                  <td className="px-5 py-3">
                    <div>
                      <p className="font-medium text-foreground">{loan.customer_name}</p>
                      {loan.customer_phone && <p className="text-xs text-muted-foreground">{loan.customer_phone}</p>}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-right text-foreground">{formatCurrency(loan.principal_amount)}</td>
                  <td className="px-5 py-3 text-right text-success">{formatCurrency(loan.amount_paid)}</td>
                  <td className="px-5 py-3 text-right font-semibold text-foreground">{formatCurrency(loan.outstanding_balance)}</td>
                  <td className="px-5 py-3 text-muted-foreground">{formatDate(loan.due_date)}</td>
                  <td className="px-5 py-3"><StatusBadge status={loan.status} colorClass={getLoanStatusColor(loan.status)} /></td>
                  <td className="px-5 py-3"><StatusBadge status={loan.collection_status} colorClass={getCollectionStatusColor(loan.collection_status)} /></td>
                  <td className="px-5 py-3 text-center">
                    {loan.status !== "completed" && (
                      <button onClick={() => setSelectedLoan(loan)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors">
                        <DollarSign className="w-3 h-3" /> Pay
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!isLoading && filtered.length === 0 && (
                <tr><td colSpan={9} className="px-5 py-10 text-center text-muted-foreground">
                  {loans.length === 0 ? "No loans yet — click \"Add Loan\" or use Imports to upload a CSV" : "No loans match your search"}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-3 border-t border-border text-xs text-muted-foreground">
          Showing {filtered.length} of {loans.length} loans
        </div>
      </div>

      {showAdd && <AddLoanModal onClose={() => setShowAdd(false)} />}
      {selectedLoan && <RecordPaymentModal loan={selectedLoan} onClose={() => setSelectedLoan(null)} />}
    </div>
  );
}
