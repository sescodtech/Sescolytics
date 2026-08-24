"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDate } from "@/lib/utils";
import { Search, Plus, X, User, CreditCard, TrendingUp, Bell, Pencil, Check } from "lucide-react";
import { toast } from "sonner";
import { formatCurrency, formatDateTime, getLoanStatusColor, getCollectionStatusColor } from "@/lib/utils";
import type { Tables } from "@/lib/supabase/types";

type Customer = Tables<"customers">;

function AddCustomerModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ full_name: "", phone: "", email: "", address: "", gender: "male" as "male"|"female"|"other" });

  const mutation = useMutation({
    mutationFn: async () => {
      if (!form.full_name || !form.phone) throw new Error("Name and phone are required");
      const code = `CUS-${Date.now()}`;
      const { error } = await supabase.from("customers").insert({
        full_name: form.full_name, phone: form.phone,
        email: form.email || null, address: form.address || null,
        gender: form.gender, customer_code: code,
        date_joined: new Date().toISOString().slice(0, 10),
        status: "active",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Customer added");
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-card rounded-xl shadow-xl w-full max-w-md border border-border">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="font-semibold text-foreground">Add Customer</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-4">
          {[
            { label: "Full Name *", key: "full_name", type: "text", placeholder: "e.g. Adaeze Okonkwo" },
            { label: "Phone *", key: "phone", type: "tel", placeholder: "e.g. 08012345678" },
            { label: "Email", key: "email", type: "email", placeholder: "optional" },
            { label: "Address", key: "address", type: "text", placeholder: "optional" },
          ].map(({ label, key, type, placeholder }) => (
            <div key={key}>
              <label className="block text-sm font-medium mb-1.5">{label}</label>
              <input type={type} value={(form as Record<string, string>)[key]} onChange={e => set(key, e.target.value)}
                placeholder={placeholder}
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
          ))}
          <div>
            <label className="block text-sm font-medium mb-1.5">Gender</label>
            <select value={form.gender} onChange={e => set("gender", e.target.value)}
              className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>
        <div className="flex gap-3 px-6 py-4 border-t border-border">
          <button onClick={onClose} className="flex-1 py-2.5 border border-border rounded-lg text-sm font-medium hover:bg-muted/40">Cancel</button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending}
            className="flex-1 py-2.5 brand-gradient text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-60">
            {mutation.isPending ? "Saving..." : "Add Customer"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CustomerDetailDrawer({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [editingContact, setEditingContact] = useState(false);
  const [phoneDraft, setPhoneDraft] = useState(customer.phone);
  const [emailDraft, setEmailDraft] = useState(customer.email ?? "");
  const [saving, setSaving] = useState(false);

  const { data: loans = [], isLoading: loansLoading } = useQuery({
    queryKey: ["customer-loans", customer.id],
    queryFn: async () => {
      const { data } = await supabase.from("loans").select("*").eq("customer_id", customer.id).order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const { data: investments = [], isLoading: investmentsLoading } = useQuery({
    queryKey: ["customer-investments", customer.id],
    queryFn: async () => {
      const { data } = await supabase.from("investments").select("*").eq("customer_id", customer.id).order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const { data: reminders = [] } = useQuery({
    queryKey: ["customer-reminders", customer.id, loans.map((l) => l.id).join(",")],
    queryFn: async () => {
      if (!loans.length) return [];
      const { data } = await supabase
        .from("reminders")
        .select("*")
        .in("loan_id", loans.map((l) => l.id))
        .order("created_at", { ascending: false })
        .limit(10);
      return data ?? [];
    },
    enabled: loans.length > 0,
  });

  const saveContact = async () => {
    setSaving(true);
    try {
      const { error } = await supabase.from("customers").update({ phone: phoneDraft, email: emailDraft || null }).eq("id", customer.id);
      if (error) throw error;
      toast.success("Contact info updated");
      setEditingContact(false);
      queryClient.invalidateQueries({ queryKey: ["customers"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50">
      <div className="bg-card w-full max-w-lg h-full overflow-y-auto border-l border-border">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-card z-10">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
              <User className="w-4 h-4 text-primary" />
            </div>
            <div className="min-w-0">
              <h2 className="font-semibold text-foreground truncate">{customer.full_name}</h2>
              <p className="text-xs text-muted-foreground font-mono">{customer.customer_code}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground flex-shrink-0"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6 space-y-6">
          {/* Contact info */}
          <div className="bg-muted/30 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-foreground uppercase tracking-wide">Contact Information</p>
              {!editingContact ? (
                <button onClick={() => setEditingContact(true)} className="text-xs text-primary font-medium flex items-center gap-1 hover:underline">
                  <Pencil className="w-3 h-3" /> Edit
                </button>
              ) : (
                <button onClick={saveContact} disabled={saving} className="text-xs text-success font-medium flex items-center gap-1 hover:underline disabled:opacity-60">
                  <Check className="w-3 h-3" /> {saving ? "Saving…" : "Save"}
                </button>
              )}
            </div>
            {!editingContact ? (
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><p className="text-xs text-muted-foreground">Phone</p><p className="text-foreground">{customer.phone || "—"}</p></div>
                <div>
                  <p className="text-xs text-muted-foreground">Email</p>
                  <p className={customer.email ? "text-foreground" : "text-amber-600"}>{customer.email || "⚠ No email on file"}</p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <input value={phoneDraft} onChange={(e) => setPhoneDraft(e.target.value)} placeholder="Phone"
                  className="border border-border rounded-lg px-2.5 py-1.5 text-sm" />
                <input value={emailDraft} onChange={(e) => setEmailDraft(e.target.value)} placeholder="Email"
                  className="border border-border rounded-lg px-2.5 py-1.5 text-sm" />
              </div>
            )}
          </div>

          {/* Loans */}
          <div>
            <p className="text-xs font-semibold text-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <CreditCard className="w-3.5 h-3.5" /> Loans {loans.length > 0 && `(${loans.length})`}
            </p>
            {loansLoading ? (
              <div className="h-12 bg-muted animate-pulse rounded-lg" />
            ) : loans.length === 0 ? (
              <p className="text-sm text-muted-foreground">No loans imported for this customer yet.</p>
            ) : (
              <div className="space-y-2">
                {loans.map((l) => (
                  <div key={l.id} className="border border-border rounded-lg p-3 flex items-center justify-between text-sm">
                    <div>
                      <p className="font-medium text-foreground">{l.loan_number}</p>
                      <p className="text-xs text-muted-foreground">Due {l.due_date ? new Date(l.due_date).toLocaleDateString() : "—"}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-medium text-foreground">{formatCurrency(l.outstanding_balance)}</p>
                      <StatusBadge status={l.status} colorClass={getLoanStatusColor(l.status)} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Investments */}
          <div>
            <p className="text-xs font-semibold text-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5" /> Investments {investments.length > 0 && `(${investments.length})`}
            </p>
            {investmentsLoading ? (
              <div className="h-12 bg-muted animate-pulse rounded-lg" />
            ) : investments.length === 0 ? (
              <p className="text-sm text-muted-foreground">No investments imported for this customer yet.</p>
            ) : (
              <div className="space-y-2">
                {investments.map((inv) => (
                  <div key={inv.id} className="border border-border rounded-lg p-3 flex items-center justify-between text-sm">
                    <div>
                      <p className="font-medium text-foreground">{inv.investment_number}</p>
                      <p className="text-xs text-muted-foreground">Matures {new Date(inv.maturity_date).toLocaleDateString()}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-medium text-foreground">{formatCurrency(inv.amount)}</p>
                      <span className="text-xs text-muted-foreground capitalize">{inv.status.replace(/_/g, " ")}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Reminder history */}
          <div>
            <p className="text-xs font-semibold text-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <Bell className="w-3.5 h-3.5" /> Recent Reminders
            </p>
            {reminders.length === 0 ? (
              <p className="text-sm text-muted-foreground">No reminders sent yet.</p>
            ) : (
              <div className="space-y-1.5">
                {reminders.map((r) => (
                  <div key={r.id} className="flex items-center justify-between text-xs border-b border-border/60 pb-1.5">
                    <span className="text-muted-foreground">{formatDateTime(r.created_at)} · {r.channel}</span>
                    <span className={r.status === "sent" ? "text-success font-medium" : r.status === "failed" ? "text-destructive font-medium" : "text-muted-foreground"}>
                      {r.status}{r.status === "failed" && r.error ? ` — ${r.error}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {loans.some((l) => ["overdue", "due_today", "due_tomorrow"].includes(l.status)) && (
            <a
              href={`/reminders?loanIds=${loans.filter((l) => ["overdue", "due_today", "due_tomorrow"].includes(l.status)).map((l) => l.id).join(",")}`}
              className="block text-center px-4 py-2.5 brand-gradient text-white rounded-lg text-sm font-medium hover:opacity-90"
            >
              Send Reminder ({loans.filter((l) => ["overdue", "due_today", "due_tomorrow"].includes(l.status)).length} due loan{loans.filter((l) => ["overdue", "due_today", "due_tomorrow"].includes(l.status)).length > 1 ? "s" : ""})
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CustomersPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showAdd, setShowAdd] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  const { data: customers = [], isLoading } = useQuery({
    queryKey: ["customers"],
    queryFn: async () => {
      const { data } = await supabase.from("customers").select("*").order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const filtered = customers.filter(c => {
    const matchSearch = c.full_name.toLowerCase().includes(search.toLowerCase()) ||
      c.phone.includes(search) || c.customer_code.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || c.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const getStatusColor = (s: string) => ({
    active: "bg-green-100 text-green-800",
    inactive: "bg-gray-100 text-gray-700",
    archived: "bg-red-100 text-red-800",
  }[s] ?? "bg-gray-100 text-gray-700");

  return (
    <div className="p-6">
      <PageHeader title="Customers" description={`${customers.length} registered customers`}>
        <button onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-4 py-2 brand-gradient text-white rounded-lg text-sm font-medium hover:opacity-90">
          <Plus className="w-4 h-4" /> Add Customer
        </button>
      </PageHeader>

      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, phone, or code..."
            className="w-full pl-9 pr-4 py-2.5 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 bg-card" />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="border border-border rounded-lg px-3 py-2.5 text-sm bg-card min-w-32 focus:outline-none focus:ring-2 focus:ring-primary/30">
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="archived">Archived</option>
        </select>
      </div>

      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">Code</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">Name</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">Phone</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">Email</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">Gender</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">Joined</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>{Array.from({ length: 7 }).map((_, j) => (
                    <td key={j} className="px-5 py-3"><div className="h-4 bg-muted animate-pulse rounded" /></td>
                  ))}</tr>
                ))
              ) : filtered.map(c => (
                <tr key={c.id} className="hover:bg-muted/20 transition-colors cursor-pointer" onClick={() => setSelectedCustomer(c)}>
                  <td className="px-5 py-3 font-mono text-xs text-muted-foreground">{c.customer_code}</td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <User className="w-3.5 h-3.5 text-primary" />
                      </div>
                      <span className="font-medium text-foreground">{c.full_name}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{c.phone}</td>
                  <td className="px-5 py-3 text-muted-foreground">{c.email ?? "—"}</td>
                  <td className="px-5 py-3 text-muted-foreground capitalize">{c.gender ?? "—"}</td>
                  <td className="px-5 py-3 text-muted-foreground">{formatDate(c.date_joined)}</td>
                  <td className="px-5 py-3"><StatusBadge status={c.status} colorClass={getStatusColor(c.status)} /></td>
                </tr>
              ))}
              {!isLoading && filtered.length === 0 && (
                <tr><td colSpan={7} className="px-5 py-10 text-center text-muted-foreground">No customers found</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-3 border-t border-border text-xs text-muted-foreground">
          Showing {filtered.length} of {customers.length} customers
        </div>
      </div>

      {showAdd && <AddCustomerModal onClose={() => setShowAdd(false)} />}
      {selectedCustomer && <CustomerDetailDrawer customer={selectedCustomer} onClose={() => setSelectedCustomer(null)} />}
    </div>
  );
}
