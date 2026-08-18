"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Zap, Plus, X, Mail, MessageCircle, Phone, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Tables } from "@/lib/supabase/types";

type Template = Tables<"reminder_templates">;

function TemplateModal({ template, onClose }: { template?: Template; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: template?.name ?? "",
    channel: template?.channel ?? "sms" as "sms" | "whatsapp" | "email",
    subject: template?.subject ?? "",
    body: template?.body ?? "",
  });

  const VARS = ["{customer_name}", "{loan_number}", "{amount}", "{due_date}", "{outstanding}"];

  const mutation = useMutation({
    mutationFn: async () => {
      if (!form.name || !form.body) throw new Error("Name and body are required");
      if (template) {
        const { error } = await supabase.from("reminder_templates").update({ ...form }).eq("id", template.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("reminder_templates").insert({ ...form, active: true });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(template ? "Template updated" : "Template created");
      queryClient.invalidateQueries({ queryKey: ["automation-templates"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-card rounded-xl shadow-xl w-full max-w-lg border border-border">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="font-semibold text-foreground">{template ? "Edit Template" : "New Template"}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1.5">Template Name</label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. 3-Day Due Reminder"
              className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">Channel</label>
            <div className="flex gap-2">
              {(["sms", "whatsapp", "email"] as const).map(ch => (
                <button key={ch} onClick={() => setForm(f => ({ ...f, channel: ch }))}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border text-sm font-medium transition-all ${form.channel === ch ? "border-primary bg-primary/10 text-primary" : "border-border hover:border-primary/40"}`}>
                  {ch === "email" ? <Mail className="w-3.5 h-3.5" /> : ch === "whatsapp" ? <MessageCircle className="w-3.5 h-3.5" /> : <Phone className="w-3.5 h-3.5" />}
                  {ch.charAt(0).toUpperCase() + ch.slice(1)}
                </button>
              ))}
            </div>
          </div>
          {form.channel === "email" && (
            <div>
              <label className="block text-sm font-medium mb-1.5">Email Subject</label>
              <input value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
                placeholder="e.g. Loan repayment reminder"
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium mb-1.5">Message Body</label>
            <div className="flex flex-wrap gap-1 mb-2">
              {VARS.map(v => (
                <button key={v} onClick={() => setForm(f => ({ ...f, body: f.body + v }))}
                  className="px-2 py-0.5 bg-muted rounded text-xs font-mono text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors">
                  {v}
                </button>
              ))}
            </div>
            <textarea value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} rows={4}
              placeholder="Dear {customer_name}, your loan {loan_number} of ₦{amount} is due on {due_date}..."
              className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none font-mono" />
          </div>
        </div>
        <div className="flex gap-3 px-6 py-4 border-t border-border">
          <button onClick={onClose} className="flex-1 py-2.5 border border-border rounded-lg text-sm font-medium hover:bg-muted/40">Cancel</button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending}
            className="flex-1 py-2.5 brand-gradient text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-60">
            {mutation.isPending ? "Saving..." : "Save Template"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AutomationPage() {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState<Template | undefined>();

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["automation-templates"],
    queryFn: async () => {
      const { data } = await supabase.from("reminder_templates").select("*").order("created_at");
      return data ?? [];
    },
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.from("reminder_templates").update({ active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["automation-templates"] }),
  });

  const deleteTemplate = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("reminder_templates").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Template deleted");
      queryClient.invalidateQueries({ queryKey: ["automation-templates"] });
    },
  });

  const channelIcon = (ch: string) => ({
    email: <Mail className="w-4 h-4" />,
    whatsapp: <MessageCircle className="w-4 h-4" />,
    sms: <Phone className="w-4 h-4" />,
  }[ch]);

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Automation" description="Manage reminder templates and automated workflows">
        <button onClick={() => { setEditTarget(undefined); setShowModal(true); }}
          className="flex items-center gap-2 px-4 py-2 brand-gradient text-white rounded-lg text-sm font-medium hover:opacity-90">
          <Plus className="w-4 h-4" /> New Template
        </button>
      </PageHeader>

      {/* Info banner */}
      <div className="flex items-start gap-3 px-4 py-3 bg-primary/5 border border-primary/20 rounded-xl">
        <Zap className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
        <p className="text-sm text-foreground/80">
          Templates are used to send automated reminders via SMS, WhatsApp, or Email. Use variables like <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">{"{"} customer_name {"}"}</code> that get replaced with real data when sent.
        </p>
      </div>

      {/* Templates grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-40 bg-muted animate-pulse rounded-xl" />
          ))}
        </div>
      ) : templates.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Zap className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No templates yet</p>
          <p className="text-sm mt-1">Create your first reminder template to get started</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map(t => (
            <div key={t.id} className={`bg-card border rounded-xl p-5 shadow-sm transition-all ${t.active ? "border-border" : "border-dashed border-border opacity-60"}`}>
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${t.channel === "email" ? "bg-blue-100 text-blue-800" : t.channel === "whatsapp" ? "bg-green-100 text-green-800" : "bg-purple-100 text-purple-800"}`}>
                    {channelIcon(t.channel)} {t.channel}
                  </span>
                  {!t.active && <span className="text-xs text-muted-foreground">(inactive)</span>}
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" checked={t.active} className="sr-only peer"
                    onChange={e => toggleActive.mutate({ id: t.id, active: e.target.checked })} />
                  <div className="w-8 h-4 bg-muted peer-checked:bg-primary rounded-full peer-focus:ring-2 peer-focus:ring-primary/30 after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-3 after:h-3 after:rounded-full after:bg-white after:transition-all peer-checked:after:translate-x-4" />
                </label>
              </div>
              <h3 className="font-semibold text-foreground text-sm mb-1">{t.name}</h3>
              {t.subject && <p className="text-xs text-muted-foreground mb-1 font-medium">{t.subject}</p>}
              <p className="text-xs text-muted-foreground line-clamp-3 font-mono">{t.body}</p>
              <div className="flex gap-2 mt-4 pt-3 border-t border-border">
                <button onClick={() => { setEditTarget(t); setShowModal(true); }}
                  className="flex-1 flex items-center justify-center gap-1 py-1.5 border border-border rounded-lg text-xs font-medium hover:bg-muted/40 transition-colors">
                  <Pencil className="w-3 h-3" /> Edit
                </button>
                <button onClick={() => { if (confirm("Delete this template?")) deleteTemplate.mutate(t.id); }}
                  className="flex items-center justify-center gap-1 px-3 py-1.5 border border-red-200 rounded-lg text-xs font-medium text-destructive hover:bg-red-50 transition-colors">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && <TemplateModal template={editTarget} onClose={() => { setShowModal(false); setEditTarget(undefined); }} />}
    </div>
  );
}
