"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { formatCurrency, formatDate, getLoanStatusColor, getCollectionStatusColor } from "@/lib/utils";
import { Search, MessageSquare, X } from "lucide-react";
import { toast } from "sonner";
import type { Tables } from "@/lib/supabase/types";

type Loan = Tables<"loans">;
type CollectionStatus = Tables<"loans">["collection_status"];

const COLLECTION_STATUSES: CollectionStatus[] = [
  "current", "reminder_sent", "follow_up_required", "promise_to_pay", "partially_paid", "fully_paid"
];

function UpdateStatusModal({ loan, onClose }: { loan: Loan; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<CollectionStatus>(loan.collection_status);
  const [note, setNote] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("loans").update({ collection_status: status }).eq("id", loan.id);
      if (error) throw error;
      if (note.trim()) {
        await supabase.from("collection_notes").insert({ loan_id: loan.id, note: note.trim() });
      }
    },
    onSuccess: () => {
      toast.success("Collection status updated");
      queryClient.invalidateQueries({ queryKey: ["collections"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-card rounded-xl shadow-xl w-full max-w-md border border-border">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="font-semibold text-foreground">Update Collection Status</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{loan.loan_number} · {loan.customer_name}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="bg-muted/40 rounded-lg p-3 grid grid-cols-2 gap-2 text-sm">
            <div><span className="text-muted-foreground">Outstanding:</span> <span className="font-semibold text-destructive">{formatCurrency(loan.outstanding_balance)}</span></div>
            <div><span className="text-muted-foreground">Due:</span> <span className="font-medium">{formatDate(loan.due_date)}</span></div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Collection Status</label>
            <div className="grid grid-cols-2 gap-2">
              {COLLECTION_STATUSES.map(s => (
                <button key={s} onClick={() => setStatus(s)}
                  className={`px-3 py-2 rounded-lg text-xs font-medium border transition-all ${status === s ? "border-primary bg-primary/10 text-primary" : "border-border hover:border-primary/40"}`}>
                  {s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">Collection Note (optional)</label>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={3}
              placeholder="e.g. Customer promised to pay by Friday..."
              className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none" />
          </div>
        </div>
        <div className="flex gap-3 px-6 py-4 border-t border-border">
          <button onClick={onClose} className="flex-1 py-2.5 border border-border rounded-lg text-sm font-medium hover:bg-muted/40">Cancel</button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending}
            className="flex-1 py-2.5 brand-gradient text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-60">
            {mutation.isPending ? "Saving..." : "Update Status"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CollectionsPage() {
  const [search, setSearch] = useState("");
  const [collectionFilter, setCollectionFilter] = useState("all");
  const [selected, setSelected] = useState<Loan | null>(null);

  const { data: loans = [], isLoading } = useQuery({
    queryKey: ["collections"],
    queryFn: async () => {
      const { data } = await supabase
        .from("loans")
        .select("*")
        .neq("status", "completed")
        .order("outstanding_balance", { ascending: false });
      return data ?? [];
    },
  });

  const filtered = loans.filter(l => {
    const matchSearch = l.customer_name.toLowerCase().includes(search.toLowerCase()) ||
      l.loan_number.toLowerCase().includes(search.toLowerCase());
    const matchStatus = collectionFilter === "all" || l.collection_status === collectionFilter;
    return matchSearch && matchStatus;
  });

  const totalOutstanding = filtered.reduce((s, l) => s + l.outstanding_balance, 0);

  return (
    <div className="p-6">
      <PageHeader title="Collections" description={`${filtered.length} active loans · ${formatCurrency(totalOutstanding)} outstanding`} />

      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search loans..."
            className="w-full pl-9 pr-4 py-2.5 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 bg-card" />
        </div>
        <select value={collectionFilter} onChange={e => setCollectionFilter(e.target.value)}
          className="border border-border rounded-lg px-3 py-2.5 text-sm bg-card min-w-40 focus:outline-none focus:ring-2 focus:ring-primary/30">
          <option value="all">All Collection Status</option>
          {COLLECTION_STATUSES.map(s => (
            <option key={s} value={s}>{s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}</option>
          ))}
        </select>
      </div>

      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">Loan #</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">Customer</th>
                <th className="text-right px-5 py-3 text-xs font-medium text-muted-foreground">Outstanding</th>
                <th className="text-right px-5 py-3 text-xs font-medium text-muted-foreground">Paid</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">Due Date</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">Loan Status</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">Collection</th>
                <th className="text-center px-5 py-3 text-xs font-medium text-muted-foreground">Update</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>{Array.from({ length: 8 }).map((_, j) => (
                    <td key={j} className="px-5 py-3"><div className="h-4 bg-muted animate-pulse rounded" /></td>
                  ))}</tr>
                ))
              ) : filtered.map(loan => (
                <tr key={loan.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-5 py-3 font-mono text-xs font-medium text-foreground">{loan.loan_number}</td>
                  <td className="px-5 py-3">
                    <div>
                      <p className="font-medium text-foreground">{loan.customer_name}</p>
                      {loan.customer_phone && <p className="text-xs text-muted-foreground">{loan.customer_phone}</p>}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-right font-bold text-destructive">{formatCurrency(loan.outstanding_balance)}</td>
                  <td className="px-5 py-3 text-right text-success">{formatCurrency(loan.amount_paid)}</td>
                  <td className="px-5 py-3 text-muted-foreground">{formatDate(loan.due_date)}</td>
                  <td className="px-5 py-3"><StatusBadge status={loan.status} colorClass={getLoanStatusColor(loan.status)} /></td>
                  <td className="px-5 py-3"><StatusBadge status={loan.collection_status} colorClass={getCollectionStatusColor(loan.collection_status)} /></td>
                  <td className="px-5 py-3 text-center">
                    <button onClick={() => setSelected(loan)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors">
                      <MessageSquare className="w-3 h-3" /> Update
                    </button>
                  </td>
                </tr>
              ))}
              {!isLoading && filtered.length === 0 && (
                <tr><td colSpan={8} className="px-5 py-10 text-center text-muted-foreground">No loans found</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-3 border-t border-border text-xs text-muted-foreground">
          {filtered.length} loans · Total outstanding: {formatCurrency(totalOutstanding)}
        </div>
      </div>

      {selected && <UpdateStatusModal loan={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
