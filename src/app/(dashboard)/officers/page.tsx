"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency } from "@/lib/utils";
import { Users, CreditCard, Search, UserCheck, X, ChevronDown } from "lucide-react";
import { toast } from "sonner";

type Profile = {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  active: boolean;
  branch_id: string | null;
};

type Loan = {
  id: string;
  loan_number: string;
  customer_name: string;
  outstanding_balance: number;
  status: string;
  assigned_officer_id: string | null;
};

function AssignModal({ officer, loans, onClose }: {
  officer: Profile;
  loans: Loan[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(
    new Set(loans.filter(l => l.assigned_officer_id === officer.id).map(l => l.id))
  );

  const filtered = loans.filter(l =>
    l.customer_name.toLowerCase().includes(search.toLowerCase()) ||
    l.loan_number.toLowerCase().includes(search.toLowerCase())
  );

  const mutation = useMutation({
    mutationFn: async () => {
      // Unassign all from this officer first
      await supabase.from("loans")
        .update({ assigned_officer_id: null })
        .eq("assigned_officer_id", officer.id);

      // Assign selected
      if (selected.size > 0) {
        await supabase.from("loans")
          .update({ assigned_officer_id: officer.id })
          .in("id", Array.from(selected));
      }
    },
    onSuccess: () => {
      toast.success(`Assignments updated for ${officer.full_name}`);
      queryClient.invalidateQueries({ queryKey: ["officers-loans"] });
      queryClient.invalidateQueries({ queryKey: ["loans"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const unassigned = filtered.filter(l => !l.assigned_officer_id || l.assigned_officer_id === officer.id);
  const alreadyOther = filtered.filter(l => l.assigned_officer_id && l.assigned_officer_id !== officer.id);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-card rounded-xl shadow-xl w-full max-w-xl border border-border flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <div>
            <h2 className="font-semibold text-foreground">Assign Loans</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Officer: {officer.full_name} · {selected.size} selected</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-6 py-3 border-b border-border flex-shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search loans..."
              className="w-full pl-9 pr-4 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-1">
          {unassigned.length === 0 && alreadyOther.length === 0 && (
            <p className="text-center text-muted-foreground text-sm py-8">No loans found</p>
          )}

          {unassigned.map(loan => (
            <label key={loan.id}
              className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${selected.has(loan.id) ? "bg-primary/8 border border-primary/20" : "hover:bg-muted/40 border border-transparent"}`}>
              <input type="checkbox" checked={selected.has(loan.id)} onChange={() => toggle(loan.id)}
                className="w-4 h-4 accent-primary rounded" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{loan.customer_name}</p>
                <p className="text-xs text-muted-foreground">{loan.loan_number} · {formatCurrency(loan.outstanding_balance)} outstanding</p>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${loan.status === "overdue" ? "bg-red-100 text-red-700" : loan.status === "due_today" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"}`}>
                {loan.status.replace(/_/g, " ")}
              </span>
            </label>
          ))}

          {alreadyOther.length > 0 && (
            <div className="pt-3">
              <p className="text-xs font-medium text-muted-foreground mb-2 px-1">Already assigned to another officer</p>
              {alreadyOther.map(loan => (
                <div key={loan.id} className="flex items-center gap-3 p-3 rounded-lg opacity-50">
                  <input type="checkbox" disabled className="w-4 h-4 rounded" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{loan.customer_name}</p>
                    <p className="text-xs text-muted-foreground">{loan.loan_number}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-border flex-shrink-0">
          <button onClick={onClose} className="flex-1 py-2.5 border border-border rounded-lg text-sm font-medium hover:bg-muted/40">Cancel</button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending}
            className="flex-1 py-2.5 brand-gradient text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-60">
            {mutation.isPending ? "Saving..." : `Save Assignments (${selected.size})`}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function OfficersPage() {
  const [search, setSearch] = useState("");
  const [assignTarget, setAssignTarget] = useState<Profile | null>(null);

  const { data: officers = [], isLoading: loadingOfficers } = useQuery({
    queryKey: ["officers"],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("*")
        .eq("active", true)
        .order("full_name");
      return (data ?? []) as Profile[];
    },
  });

  const { data: loans = [] } = useQuery({
    queryKey: ["officers-loans"],
    queryFn: async () => {
      const { data } = await supabase
        .from("loans")
        .select("id, loan_number, customer_name, outstanding_balance, status, assigned_officer_id")
        .neq("status", "completed")
        .order("customer_name");
      return (data ?? []) as Loan[];
    },
  });

  const { data: roles = [] } = useQuery({
    queryKey: ["all-roles"],
    queryFn: async () => {
      const { data } = await supabase.from("user_roles").select("user_id, role");
      return data ?? [];
    },
  });

  const getOfficerStats = (officerId: string) => {
    const assigned = loans.filter(l => l.assigned_officer_id === officerId);
    const overdue = assigned.filter(l => l.status === "overdue").length;
    const total = assigned.reduce((s, l) => s + l.outstanding_balance, 0);
    return { count: assigned.length, overdue, total };
  };

  const getOfficerRoles = (officerId: string) =>
    roles.filter(r => r.user_id === officerId).map(r =>
      r.role.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())
    );

  const filtered = officers.filter(o =>
    o.full_name.toLowerCase().includes(search.toLowerCase()) ||
    o.email.toLowerCase().includes(search.toLowerCase())
  );

  const unassigned = loans.filter(l => !l.assigned_officer_id).length;

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Account Officers" description="Manage staff and loan assignments">
        <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-lg">
          <span className="text-xs font-medium text-amber-800">{unassigned} unassigned loans</span>
        </div>
      </PageHeader>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Total Officers</p>
          <p className="text-2xl font-display font-bold text-foreground mt-1">{officers.length}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Assigned Loans</p>
          <p className="text-2xl font-display font-bold text-foreground mt-1">
            {loans.filter(l => l.assigned_officer_id).length}
          </p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Unassigned</p>
          <p className="text-2xl font-display font-bold text-destructive mt-1">{unassigned}</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search officers..."
          className="w-full pl-9 pr-4 py-2.5 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 bg-card" />
      </div>

      {/* Officers grid */}
      {loadingOfficers ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-40 bg-muted animate-pulse rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(officer => {
            const stats = getOfficerStats(officer.id);
            const officerRoles = getOfficerRoles(officer.id);
            return (
              <div key={officer.id} className="bg-card border border-border rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow">
                {/* Header */}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full brand-gradient flex items-center justify-center flex-shrink-0">
                      <span className="text-sm font-bold text-white">
                        {officer.full_name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground text-sm leading-tight">{officer.full_name}</p>
                      <p className="text-xs text-muted-foreground truncate">{officer.email}</p>
                    </div>
                  </div>
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 mt-1 ${officer.active ? "bg-success" : "bg-muted-foreground"}`} />
                </div>

                {/* Roles */}
                {officerRoles.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-3">
                    {officerRoles.map(r => (
                      <span key={r} className="px-2 py-0.5 bg-primary/10 text-primary rounded-full text-xs font-medium">{r}</span>
                    ))}
                  </div>
                )}

                {/* Stats */}
                <div className="grid grid-cols-3 gap-2 mb-4">
                  <div className="text-center">
                    <p className="text-lg font-bold text-foreground">{stats.count}</p>
                    <p className="text-xs text-muted-foreground">Loans</p>
                  </div>
                  <div className="text-center border-x border-border">
                    <p className="text-lg font-bold text-destructive">{stats.overdue}</p>
                    <p className="text-xs text-muted-foreground">Overdue</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs font-bold text-foreground">{stats.total > 0 ? formatCurrency(stats.total) : "₦0"}</p>
                    <p className="text-xs text-muted-foreground">Portfolio</p>
                  </div>
                </div>

                {/* Assign button */}
                <button onClick={() => setAssignTarget(officer)}
                  className="w-full flex items-center justify-center gap-2 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted/40 transition-colors">
                  <UserCheck className="w-4 h-4 text-primary" />
                  Manage Assignments
                </button>
              </div>
            );
          })}

          {filtered.length === 0 && (
            <div className="col-span-3 text-center py-16 text-muted-foreground">
              <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>No officers found</p>
            </div>
          )}
        </div>
      )}

      {/* Assign modal */}
      {assignTarget && (
        <AssignModal
          officer={assignTarget}
          loans={loans}
          onClose={() => setAssignTarget(null)}
        />
      )}
    </div>
  );
}
