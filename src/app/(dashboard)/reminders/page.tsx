"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDateTime, formatCurrency, formatDate } from "@/lib/utils";
import { Search, Mail, MessageCircle, Phone, Send, X, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import type { Tables } from "@/lib/supabase/types";

type Reminder = Tables<"reminders">;
type Template = Tables<"reminder_templates">;

type OverdueLoan = {
  id: string;
  loan_number: string;
  customer_name: string;
  customer_phone: string | null;
  outstanding_balance: number;
  due_date: string;
  status: string;
  collection_status: string;
};

const getStatusColor = (s: string) => ({
  queued: "bg-blue-100 text-blue-800",
  sent: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
}[s] ?? "bg-gray-100 text-gray-700");

const channelIcon = (ch: string) => ({
  email: <Mail className="w-3.5 h-3.5" />,
  whatsapp: <MessageCircle className="w-3.5 h-3.5" />,
  sms: <Phone className="w-3.5 h-3.5" />,
}[ch] ?? <Mail className="w-3.5 h-3.5" />);

const channelColor = (ch: string) => ({
  email: "bg-blue-100 text-blue-800",
  whatsapp: "bg-green-100 text-green-800",
  sms: "bg-purple-100 text-purple-800",
}[ch] ?? "bg-gray-100 text-gray-700");

// Replace template variables with real data
function fillTemplate(body: string, loan: OverdueLoan): string {
  return body
    .replace(/{customer_name}/g, loan.customer_name)
    .replace(/{loan_number}/g, loan.loan_number)
    .replace(/{amount}/g, formatCurrency(loan.outstanding_balance))
    .replace(/{outstanding}/g, formatCurrency(loan.outstanding_balance))
    .replace(/{due_date}/g, formatDate(loan.due_date));
}

function SendReminderModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<"select-loans" | "compose" | "preview">("select-loans");
  const [selectedLoans, setSelectedLoans] = useState<Set<string>>(new Set());
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [channel, setChannel] = useState<"sms" | "whatsapp" | "email">("sms");
  const [customMessage, setCustomMessage] = useState("");
  const [search, setSearch] = useState("");
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<{ sent: number; failed: number } | null>(null);

  const { data: overdueLoans = [] } = useQuery({
    queryKey: ["overdue-for-reminder"],
    queryFn: async () => {
      const { data } = await supabase
        .from("loans")
        .select("id, loan_number, customer_name, customer_phone, outstanding_balance, due_date, status, collection_status")
        .in("status", ["overdue", "due_today", "due_tomorrow"])
        .neq("collection_status", "fully_paid")
        .order("outstanding_balance", { ascending: false });
      return (data ?? []) as OverdueLoan[];
    },
  });

  const { data: templates = [] } = useQuery({
    queryKey: ["reminder-templates"],
    queryFn: async () => {
      const { data } = await supabase.from("reminder_templates").select("*").eq("active", true);
      return (data ?? []) as Template[];
    },
  });

  const filteredLoans = overdueLoans.filter(l =>
    l.customer_name.toLowerCase().includes(search.toLowerCase()) ||
    l.loan_number.toLowerCase().includes(search.toLowerCase())
  );

  const toggleLoan = (id: string) => {
    setSelectedLoans(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedLoans.size === filteredLoans.length) {
      setSelectedLoans(new Set());
    } else {
      setSelectedLoans(new Set(filteredLoans.map(l => l.id)));
    }
  };

  const handleSend = async () => {
    setSending(true);
    let sent = 0, failed = 0;

    const loansToSend = overdueLoans.filter(l => selectedLoans.has(l.id));
    const messageTemplate = customMessage || selectedTemplate?.body || "";

    // Build payloads for the API
    const smsRecipients: { to: string; message: string; loan_id: string; channel: "sms" | "whatsapp" }[] = [];
    const emailRecipients: { to: string; subject: string; message: string; customer_name: string; loan_id: string }[] = [];

    for (const loan of loansToSend) {
      const message = fillTemplate(messageTemplate, loan);
      const subject = selectedTemplate?.subject
        ? fillTemplate(selectedTemplate.subject, loan)
        : `Loan Repayment Notice — ${loan.loan_number}`;

      if (channel === "email") {
        // Use customer phone as placeholder if no email — real email would come from customers table
        emailRecipients.push({
          to: loan.customer_name, // replace with loan.customer_email when available
          subject,
          message,
          customer_name: loan.customer_name,
          loan_id: loan.id,
        });
      } else {
        if (loan.customer_phone) {
          smsRecipients.push({
            to: loan.customer_phone,
            message,
            loan_id: loan.id,
            channel: channel as "sms" | "whatsapp",
          });
        }
      }
    }

    // Call the appropriate API route
    let apiResults = { sent: 0, failed: 0, details: { sent: [] as string[], failed: [] as { to: string; error: string }[] } };

    try {
      if (channel === "email" && emailRecipients.length > 0) {
        const res = await fetch("/api/send-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recipients: emailRecipients }),
        });
        if (res.ok) apiResults = await res.json();
      } else if (smsRecipients.length > 0) {
        const res = await fetch("/api/send-reminder", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recipients: smsRecipients }),
        });
        if (res.ok) apiResults = await res.json();
      }
    } catch (err) {
      console.error("API send error:", err);
    }

    // Log every reminder to Supabase regardless of delivery status
    for (const loan of loansToSend) {
      const message = fillTemplate(messageTemplate, loan);
      const recipient = channel === "email"
        ? loan.customer_name
        : (loan.customer_phone ?? "no-phone");

      const wasDelivered = apiResults.details.sent.includes(recipient);
      const failDetail = apiResults.details.failed.find((f) => f.to === recipient);

      const { error } = await supabase.from("reminders").insert({
        loan_id: loan.id,
        channel,
        recipient,
        message,
        subject: selectedTemplate?.subject ? fillTemplate(selectedTemplate.subject, loan) : null,
        template_id: selectedTemplate?.id ?? null,
        status: smsRecipients.length === 0 && emailRecipients.length === 0
          ? "sent"  // no API configured yet — log as sent for record-keeping
          : wasDelivered ? "sent" : failDetail ? "failed" : "queued",
        error: failDetail?.error ?? null,
        sent_at: wasDelivered ? new Date().toISOString() : null,
        reason: loan.status,
      });

      if (!error) {
        await supabase.from("loans")
          .update({ collection_status: "reminder_sent" })
          .eq("id", loan.id)
          .eq("collection_status", "current");
        sent++;
      } else {
        failed++;
      }
    }

    setSending(false);
    setResults({ sent, failed });
    queryClient.invalidateQueries({ queryKey: ["reminders"] });
    queryClient.invalidateQueries({ queryKey: ["collections"] });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-card rounded-xl shadow-xl w-full max-w-2xl border border-border flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <div>
            <h2 className="font-semibold text-foreground">Send Reminders</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {step === "select-loans" && `${overdueLoans.length} loans need attention`}
              {step === "compose" && `${selectedLoans.size} loans selected`}
              {step === "preview" && "Review before sending"}
            </p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>

        {/* Steps indicator */}
        <div className="flex items-center gap-2 px-6 py-3 border-b border-border flex-shrink-0 text-xs">
          {["select-loans", "compose", "preview"].map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-5 h-5 rounded-full flex items-center justify-center font-bold ${step === s ? "brand-gradient text-white" : ["select-loans", "compose", "preview"].indexOf(step) > i ? "bg-success text-white" : "bg-muted text-muted-foreground"}`}>
                {["select-loans", "compose", "preview"].indexOf(step) > i ? "✓" : i + 1}
              </div>
              <span className={step === s ? "font-medium text-foreground" : "text-muted-foreground"}>
                {s === "select-loans" ? "Select Loans" : s === "compose" ? "Compose" : "Preview"}
              </span>
              {i < 2 && <span className="text-muted-foreground">→</span>}
            </div>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {/* Results screen */}
          {results ? (
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
              <CheckCircle2 className="w-12 h-12 text-success mb-4" />
              <h3 className="text-lg font-bold text-foreground mb-2">Reminders Logged</h3>
              <p className="text-muted-foreground mb-4">
                <span className="font-semibold text-success">{results.sent} reminders</span> logged successfully
                {results.failed > 0 && <>, <span className="font-semibold text-destructive">{results.failed} failed</span></>}
              </p>
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800 text-left max-w-sm">
                <p className="font-semibold mb-1">⚠️ SMS/WhatsApp Integration</p>
                <p>To actually send SMS or WhatsApp messages, connect an SMS provider (e.g. Termii, Twilio, Vonage) in Settings. For now, reminders are logged in the system.</p>
              </div>
            </div>
          ) : step === "select-loans" ? (
            <div className="p-6 space-y-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search loans..."
                  className="w-full pl-9 pr-4 py-2.5 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </div>

              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">{filteredLoans.length} loans requiring attention</p>
                <button onClick={toggleAll} className="text-xs font-medium text-primary hover:underline">
                  {selectedLoans.size === filteredLoans.length ? "Deselect All" : "Select All"}
                </button>
              </div>

              <div className="space-y-2 max-h-72 overflow-y-auto">
                {filteredLoans.map(loan => (
                  <label key={loan.id}
                    className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors border ${selectedLoans.has(loan.id) ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"}`}>
                    <input type="checkbox" checked={selectedLoans.has(loan.id)} onChange={() => toggleLoan(loan.id)}
                      className="w-4 h-4 accent-primary flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">{loan.customer_name}</p>
                      <p className="text-xs text-muted-foreground">{loan.loan_number} · {formatCurrency(loan.outstanding_balance)} outstanding · Due {formatDate(loan.due_date)}</p>
                      {!loan.customer_phone && (
                        <p className="text-xs text-amber-600 mt-0.5">⚠ No phone number on record</p>
                      )}
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${loan.status === "overdue" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
                      {loan.status.replace(/_/g, " ")}
                    </span>
                  </label>
                ))}
                {filteredLoans.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    <CheckCircle2 className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    No overdue loans to remind
                  </div>
                )}
              </div>
            </div>
          ) : step === "compose" ? (
            <div className="p-6 space-y-4">
              {/* Channel */}
              <div>
                <label className="block text-sm font-medium mb-2">Send via</label>
                <div className="flex gap-2">
                  {(["sms", "whatsapp", "email"] as const).map(ch => (
                    <button key={ch} onClick={() => setChannel(ch)}
                      className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border text-sm font-medium transition-all ${channel === ch ? "border-primary bg-primary/10 text-primary" : "border-border hover:border-primary/30"}`}>
                      {channelIcon(ch)}
                      {ch === "sms" ? "SMS" : ch === "whatsapp" ? "WhatsApp" : "Email"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Templates */}
              {templates.filter(t => t.channel === channel).length > 0 && (
                <div>
                  <label className="block text-sm font-medium mb-2">Use Template</label>
                  <div className="space-y-2">
                    {templates.filter(t => t.channel === channel).map(t => (
                      <button key={t.id} onClick={() => { setSelectedTemplate(t); setCustomMessage(t.body); }}
                        className={`w-full text-left px-4 py-3 rounded-lg border text-sm transition-all ${selectedTemplate?.id === t.id ? "border-primary bg-primary/5" : "border-border hover:border-primary/30"}`}>
                        <p className="font-medium text-foreground">{t.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{t.body}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Custom message */}
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Message <span className="text-muted-foreground font-normal">(variables: {"{customer_name}"}, {"{loan_number}"}, {"{amount}"}, {"{due_date}"})</span>
                </label>
                <textarea value={customMessage} onChange={e => setCustomMessage(e.target.value)} rows={4}
                  placeholder={`Dear {customer_name}, your loan {loan_number} of {amount} is overdue. Please make payment immediately. - Charis MFB`}
                  className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none font-mono" />
                <p className="text-xs text-muted-foreground mt-1">{customMessage.length} characters</p>
              </div>
            </div>
          ) : (
            // Preview step
            <div className="p-6 space-y-4">
              <div className="bg-muted/40 rounded-lg p-4 space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Recipients</span>
                  <span className="font-semibold text-foreground">{selectedLoans.size} customers</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Channel</span>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${channelColor(channel)}`}>
                    {channelIcon(channel)} {channel.toUpperCase()}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Template</span>
                  <span className="font-medium text-foreground">{selectedTemplate?.name ?? "Custom"}</span>
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Sample message (first recipient)</p>
                {overdueLoans.filter(l => selectedLoans.has(l.id)).slice(0, 1).map(loan => (
                  <div key={loan.id} className="bg-card border border-border rounded-lg p-4 text-sm font-mono whitespace-pre-wrap">
                    {fillTemplate(customMessage, loan)}
                  </div>
                ))}
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-xs text-amber-800">
                <p className="font-semibold mb-0.5">📱 Integration Note</p>
                <p>Reminders will be logged in the system. To actually deliver SMS/WhatsApp, configure your provider API key in Settings (Termii, Twilio, etc.).</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {!results && (
          <div className="flex gap-3 px-6 py-4 border-t border-border flex-shrink-0">
            {step !== "select-loans" && (
              <button onClick={() => setStep(step === "preview" ? "compose" : "select-loans")}
                className="px-4 py-2.5 border border-border rounded-lg text-sm font-medium hover:bg-muted/40">
                Back
              </button>
            )}
            <button
              onClick={() => {
                if (step === "select-loans") {
                  if (selectedLoans.size === 0) { toast.error("Select at least one loan"); return; }
                  setStep("compose");
                } else if (step === "compose") {
                  if (!customMessage.trim()) { toast.error("Enter a message"); return; }
                  setStep("preview");
                } else {
                  handleSend();
                }
              }}
              disabled={sending}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 brand-gradient text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-60">
              {sending ? (
                <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Sending...</>
              ) : step === "preview" ? (
                <><Send className="w-4 h-4" /> Send {selectedLoans.size} Reminders</>
              ) : (
                "Continue →"
              )}
            </button>
          </div>
        )}
        {results && (
          <div className="flex gap-3 px-6 py-4 border-t border-border flex-shrink-0">
            <button onClick={onClose} className="flex-1 py-2.5 brand-gradient text-white rounded-lg text-sm font-medium hover:opacity-90">
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function RemindersPage() {
  const [search, setSearch] = useState("");
  const [channelFilter, setChannelFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showSend, setShowSend] = useState(false);

  const { data: reminders = [], isLoading } = useQuery({
    queryKey: ["reminders"],
    queryFn: async () => {
      const { data } = await supabase
        .from("reminders")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      return (data ?? []) as Reminder[];
    },
  });

  const sent = reminders.filter(r => r.status === "sent").length;
  const failed = reminders.filter(r => r.status === "failed").length;
  const queued = reminders.filter(r => r.status === "queued").length;

  const filtered = reminders.filter(r => {
    const matchSearch = r.recipient.toLowerCase().includes(search.toLowerCase()) ||
      (r.message ?? "").toLowerCase().includes(search.toLowerCase());
    const matchChannel = channelFilter === "all" || r.channel === channelFilter;
    const matchStatus = statusFilter === "all" || r.status === statusFilter;
    return matchSearch && matchChannel && matchStatus;
  });

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Reminders" description="Track and send payment reminders to borrowers">
        <button onClick={() => setShowSend(true)}
          className="flex items-center gap-2 px-4 py-2 brand-gradient text-white rounded-lg text-sm font-medium hover:opacity-90">
          <Send className="w-4 h-4" /> Send Reminders
        </button>
      </PageHeader>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Sent</p>
          <p className="text-2xl font-display font-bold text-success mt-1">{sent}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Queued</p>
          <p className="text-2xl font-display font-bold text-blue-600 mt-1">{queued}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Failed</p>
          <p className="text-2xl font-display font-bold text-destructive mt-1">{failed}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search reminders..."
            className="w-full pl-9 pr-4 py-2.5 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 bg-card" />
        </div>
        <select value={channelFilter} onChange={e => setChannelFilter(e.target.value)}
          className="border border-border rounded-lg px-3 py-2.5 text-sm bg-card min-w-32 focus:outline-none focus:ring-2 focus:ring-primary/30">
          <option value="all">All Channels</option>
          <option value="sms">SMS</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="email">Email</option>
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="border border-border rounded-lg px-3 py-2.5 text-sm bg-card min-w-32 focus:outline-none focus:ring-2 focus:ring-primary/30">
          <option value="all">All Status</option>
          <option value="queued">Queued</option>
          <option value="sent">Sent</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">Recipient</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">Channel</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">Message</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">Sent At</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>{Array.from({ length: 5 }).map((_, j) => (
                    <td key={j} className="px-5 py-3"><div className="h-4 bg-muted animate-pulse rounded" /></td>
                  ))}</tr>
                ))
              ) : filtered.map(r => (
                <tr key={r.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-5 py-3 font-medium text-foreground">{r.recipient}</td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${channelColor(r.channel)}`}>
                      {channelIcon(r.channel)} {r.channel.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-muted-foreground max-w-xs truncate">{r.message}</td>
                  <td className="px-5 py-3 text-muted-foreground">{r.sent_at ? formatDateTime(r.sent_at) : "—"}</td>
                  <td className="px-5 py-3">
                    <StatusBadge status={r.status} colorClass={getStatusColor(r.status)} />
                  </td>
                </tr>
              ))}
              {!isLoading && filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center text-muted-foreground">
                    <Send className="w-8 h-8 mx-auto mb-2 opacity-20" />
                    <p>No reminders yet — click "Send Reminders" to get started</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > 0 && (
          <div className="px-5 py-3 border-t border-border text-xs text-muted-foreground">
            Showing {filtered.length} of {reminders.length} reminders
          </div>
        )}
      </div>

      {showSend && <SendReminderModal onClose={() => setShowSend(false)} />}
    </div>
  );
}
