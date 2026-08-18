"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Search, Plus, X, CheckCircle, XCircle } from "lucide-react";
import { toast } from "sonner";
import type { Tables } from "@/lib/supabase/types";

type PTP = Tables<"promise_to_pay"> & { loans?: { loan_number: string; customer_name: string } | null };

const getPTPColor = (s: string) => ({
  pending: "bg-amber-100 text-amber-800",
  fulfilled: "bg-green-100 text-green-800",
  broken: "bg-red-100 text-red-800",
}[s] ?? "bg-gray-100 text-gray-700");

export default function PTPPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const { data: ptps = [], isLoading } = useQuery({
    queryKey: ["ptp"],
    queryFn: async () => {
      const { data } = await supabase
        .from("promise_to_pay")
        .select("*, loans:loan_id(loan_number, customer_name)")
        .order("promise_date", { ascending: true });
      return (data ?? []) as unknown as PTP[];
    },
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "fulfilled" | "broken" }) => {
      const { error } = await supabase.from("promise_to_pay").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("PTP status updated");
      queryClient.invalidateQueries({ queryKey: ["ptp"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = ptps.filter(p => {
    const name = p.loans?.customer_name ?? "";
    const matchSearch = name.toLowerCase().includes(search.toLowerCase()) ||
      (p.loans?.loan_number ?? "").toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || p.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const pending = ptps.filter(p => p.status === "pending");
  const totalPending = pending.reduce((s, p) => s + p.promised_amount, 0);

  return (
    <div className="p-6">
      <PageHeader title="Promise to Pay" description={`${pending.length} pending · ${formatCurrency(totalPending)} expected`} />

      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by customer or loan number..."
            className="w-full pl-9 pr-4 py-2.5 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 bg-card" />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="border border-border rounded-lg px-3 py-2.5 text-sm bg-card min-w-36 focus:outline-none focus:ring-2 focus:ring-primary/30">
          <option value="all">All</option>
          <option value="pending">Pending</option>
          <option value="fulfilled">Fulfilled</option>
          <option value="broken">Broken</option>
        </select>
      </div>

      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">Customer</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">Loan #</th>
                <th className="text-right px-5 py-3 text-xs font-medium text-muted-foreground">Promised</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">Promise Date</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">Notes</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">Status</th>
                <th className="text-center px-5 py-3 text-xs font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>{Array.from({ length: 7 }).map((_, j) => (
                    <td key={j} className="px-5 py-3"><div className="h-4 bg-muted animate-pulse rounded" /></td>
                  ))}</tr>
                ))
              ) : filtered.map(ptp => (
                <tr key={ptp.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-5 py-3 font-medium text-foreground">{ptp.loans?.customer_name ?? "—"}</td>
                  <td className="px-5 py-3 font-mono text-xs text-muted-foreground">{ptp.loans?.loan_number ?? "—"}</td>
                  <td className="px-5 py-3 text-right font-semibold text-foreground">{formatCurrency(ptp.promised_amount)}</td>
                  <td className="px-5 py-3 text-muted-foreground">{formatDate(ptp.promise_date)}</td>
                  <td className="px-5 py-3 text-muted-foreground max-w-48 truncate">{ptp.notes ?? "—"}</td>
                  <td className="px-5 py-3"><StatusBadge status={ptp.status} colorClass={getPTPColor(ptp.status)} /></td>
                  <td className="px-5 py-3">
                    {ptp.status === "pending" && (
                      <div className="flex items-center justify-center gap-2">
                        <button onClick={() => updateStatus.mutate({ id: ptp.id, status: "fulfilled" })}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-green-50 text-green-700 text-xs font-medium hover:bg-green-100 transition-colors">
                          <CheckCircle className="w-3 h-3" /> Fulfilled
                        </button>
                        <button onClick={() => updateStatus.mutate({ id: ptp.id, status: "broken" })}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-red-50 text-red-700 text-xs font-medium hover:bg-red-100 transition-colors">
                          <XCircle className="w-3 h-3" /> Broken
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {!isLoading && filtered.length === 0 && (
                <tr><td colSpan={7} className="px-5 py-10 text-center text-muted-foreground">No PTP records found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
