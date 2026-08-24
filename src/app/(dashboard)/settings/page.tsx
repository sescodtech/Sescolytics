"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/components/AuthProvider";
import { toast } from "sonner";
import { Building2, User, RefreshCw, Shield, Palette } from "lucide-react";
import { useAppSettings, useUpdateAppSettings } from "@/lib/appSettings";

export default function SettingsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const { data: appSettings } = useAppSettings();
  const updateAppSettings = useUpdateAppSettings();
  const [appNameDraft, setAppNameDraft] = useState<string | null>(null);
  const [orgNameDraft, setOrgNameDraft] = useState<string | null>(null);
  const [logoUrlDraft, setLogoUrlDraft] = useState<string | null>(null);
  const [savingBranding, setSavingBranding] = useState(false);

  const handleSaveBranding = async () => {
    setSavingBranding(true);
    try {
      await updateAppSettings({
        appName: appNameDraft ?? appSettings?.appName,
        orgName: orgNameDraft ?? appSettings?.orgName,
        logoUrl: logoUrlDraft ?? appSettings?.logoUrl,
      });
      toast.success("Branding updated — it'll show up across the app immediately");
      setAppNameDraft(null);
      setOrgNameDraft(null);
      setLogoUrlDraft(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save branding");
    } finally {
      setSavingBranding(false);
    }
  };

  const { data: profile } = useQuery({
    queryKey: ["profile"],
    queryFn: async () => {
      if (!user) return null;
      const { data } = await supabase.from("profiles").select("*").eq("id", user.id).single();
      return data;
    },
  });

  const { data: roles = [] } = useQuery({
    queryKey: ["user-roles"],
    queryFn: async () => {
      if (!user) return [];
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
      return (data ?? []).map(r => r.role);
    },
  });

  const { data: branches = [] } = useQuery({
    queryKey: ["branches"],
    queryFn: async () => {
      const { data } = await supabase.from("branches").select("*").eq("active", true).order("name");
      return data ?? [];
    },
  });

  const changePassword = useMutation({
    mutationFn: async () => {
      if (!newPassword || newPassword !== confirmPassword) throw new Error("Passwords do not match");
      if (newPassword.length < 8) throw new Error("Password must be at least 8 characters");
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Password changed successfully");
      setNewPassword("");
      setConfirmPassword("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const refreshStatuses = async () => {
    setRefreshing(true);
    try {
      await supabase.rpc("refresh_loan_statuses");
      await supabase.rpc("refresh_investment_statuses");
      queryClient.invalidateQueries();
      toast.success("Statuses refreshed successfully");
    } catch {
      toast.error("Failed to refresh statuses");
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <PageHeader title="Settings" description="Account and system configuration" />

      {/* Branding — configurable app name/org name, no hard-coding */}
      <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <Palette className="w-4 h-4 text-primary" />
          <h2 className="font-semibold text-foreground">General / Branding</h2>
        </div>
        <p className="text-xs text-muted-foreground -mt-2">
          Controls what shows in the sidebar, login page, and browser tab title across the whole app.
        </p>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1.5">Application Name</label>
            <input
              value={appNameDraft ?? appSettings?.appName ?? ""}
              onChange={(e) => setAppNameDraft(e.target.value)}
              placeholder="e.g. ILRMS"
              className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">Organization Name</label>
            <input
              value={orgNameDraft ?? appSettings?.orgName ?? ""}
              onChange={(e) => setOrgNameDraft(e.target.value)}
              placeholder="e.g. Charis Microfinance Bank"
              className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5">Logo URL (optional)</label>
          <input
            value={logoUrlDraft ?? appSettings?.logoUrl ?? ""}
            onChange={(e) => setLogoUrlDraft(e.target.value)}
            placeholder="https://…"
            className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <button
          onClick={handleSaveBranding}
          disabled={savingBranding || (appNameDraft === null && orgNameDraft === null && logoUrlDraft === null)}
          className="px-4 py-2.5 brand-gradient text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-60 transition-opacity"
        >
          {savingBranding ? "Saving…" : "Save Branding"}
        </button>
      </div>

      {/* Profile */}
      <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <User className="w-4 h-4 text-primary" />
          <h2 className="font-semibold text-foreground">My Profile</h2>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Full Name</p>
            <p className="text-sm font-medium text-foreground">{profile?.full_name ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Email</p>
            <p className="text-sm font-medium text-foreground">{profile?.email ?? user?.email ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Phone</p>
            <p className="text-sm font-medium text-foreground">{profile?.phone ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Status</p>
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${profile?.active ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-700"}`}>
              {profile?.active ? "Active" : "Inactive"}
            </span>
          </div>
        </div>
      </div>

      {/* Roles */}
      <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <Shield className="w-4 h-4 text-primary" />
          <h2 className="font-semibold text-foreground">Roles & Permissions</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {roles.map(role => (
            <span key={role} className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20">
              {role.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
            </span>
          ))}
          {roles.length === 0 && <p className="text-sm text-muted-foreground">No roles assigned</p>}
        </div>
      </div>

      {/* Branches */}
      {branches.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <Building2 className="w-4 h-4 text-primary" />
            <h2 className="font-semibold text-foreground">Branches</h2>
          </div>
          <div className="space-y-2">
            {branches.map(b => (
              <div key={b.id} className="flex items-center justify-between text-sm">
                <div>
                  <span className="font-medium text-foreground">{b.name}</span>
                  <span className="text-muted-foreground ml-2 font-mono text-xs">{b.code}</span>
                </div>
                {b.address && <span className="text-xs text-muted-foreground">{b.address}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Change password */}
      <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-4">
        <h2 className="font-semibold text-foreground">Change Password</h2>
        <div>
          <label className="block text-sm font-medium mb-1.5">New Password</label>
          <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
            placeholder="Min 8 characters"
            className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5">Confirm Password</label>
          <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
            placeholder="Repeat new password"
            className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
        </div>
        <button onClick={() => changePassword.mutate()} disabled={changePassword.isPending || !newPassword}
          className="px-4 py-2.5 brand-gradient text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-60 transition-opacity">
          {changePassword.isPending ? "Updating..." : "Update Password"}
        </button>
      </div>

      {/* System */}
      <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
        <h2 className="font-semibold text-foreground mb-3">System Maintenance</h2>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">Refresh Loan & Investment Statuses</p>
            <p className="text-xs text-muted-foreground mt-0.5">Recalculates overdue, maturing soon, and due today statuses</p>
          </div>
          <button onClick={refreshStatuses} disabled={refreshing}
            className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted/40 disabled:opacity-60 transition-all">
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Refreshing..." : "Refresh Now"}
          </button>
        </div>
      </div>

      {/* SMS Integration */}
      <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center flex-shrink-0 mt-0.5">
            <span className="text-sm">📱</span>
          </div>
          <div className="flex-1">
            <h2 className="font-semibold text-foreground">SMS Integration — Termii</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Add these to your Vercel environment variables to enable real SMS/WhatsApp delivery</p>
          </div>
          <a href="https://termii.com" target="_blank" rel="noreferrer"
            className="text-xs font-medium text-primary hover:underline flex-shrink-0">Sign up →</a>
        </div>
        <div className="bg-muted/40 rounded-lg overflow-hidden border border-border text-xs font-mono">
          <div className="px-4 py-2 bg-muted/60 text-muted-foreground font-sans font-medium text-xs border-b border-border">
            Add to Vercel → Project Settings → Environment Variables
          </div>
          {[
            { key: "TERMII_API_KEY", hint: "Your Termii API key from the dashboard" },
            { key: "TERMII_SENDER_ID", hint: 'e.g. "CHARISMFB" — max 11 chars, register with Termii' },
          ].map(({ key, hint }) => (
            <div key={key} className="px-4 py-3 border-b border-border last:border-0">
              <p className="text-foreground font-bold">{key}</p>
              <p className="text-muted-foreground mt-0.5 font-sans">{hint}</p>
            </div>
          ))}
        </div>
        <div className="text-xs text-muted-foreground bg-blue-50 border border-blue-100 rounded-lg px-4 py-3">
          <p className="font-semibold text-blue-800 mb-1">Pricing (Termii)</p>
          <p className="text-blue-700">SMS: ~₦5/message · WhatsApp: ~₦8/message · Bulk discounts available · Sender ID registration required for branded SMS</p>
        </div>
      </div>

      {/* Email Integration */}
      <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5">
            <span className="text-sm">✉️</span>
          </div>
          <div className="flex-1">
            <h2 className="font-semibold text-foreground">Email Integration — Resend</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Free up to 3,000 emails/month. Professional HTML emails with your bank branding</p>
          </div>
          <a href="https://resend.com" target="_blank" rel="noreferrer"
            className="text-xs font-medium text-primary hover:underline flex-shrink-0">Sign up →</a>
        </div>
        <div className="bg-muted/40 rounded-lg overflow-hidden border border-border text-xs font-mono">
          <div className="px-4 py-2 bg-muted/60 text-muted-foreground font-sans font-medium text-xs border-b border-border">
            Add to Vercel → Project Settings → Environment Variables
          </div>
          {[
            { key: "RESEND_API_KEY", hint: "Your Resend API key from resend.com/api-keys" },
            { key: "RESEND_FROM_EMAIL", hint: 'e.g. "noreply@charisbank.com" — must verify domain in Resend' },
            { key: "RESEND_FROM_NAME", hint: 'e.g. "Charis Microfinance Bank"' },
            { key: "BANK_PHONE", hint: "Bank contact phone shown in email footer" },
            { key: "BANK_EMAIL", hint: "Bank contact email shown in email footer" },
          ].map(({ key, hint }) => (
            <div key={key} className="px-4 py-3 border-b border-border last:border-0">
              <p className="text-foreground font-bold">{key}</p>
              <p className="text-muted-foreground mt-0.5 font-sans">{hint}</p>
            </div>
          ))}
        </div>
        <div className="text-xs text-muted-foreground bg-green-50 border border-green-100 rounded-lg px-4 py-3">
          <p className="font-semibold text-green-800 mb-1">Setup steps for Resend</p>
          <ol className="text-green-700 space-y-0.5 list-decimal list-inside">
            <li>Sign up at resend.com</li>
            <li>Go to Domains → Add your domain (e.g. charisbank.com)</li>
            <li>Add the DNS records they give you to your domain registrar</li>
            <li>Wait for verification (usually under 1 hour)</li>
            <li>Create an API key and add it to Vercel</li>
          </ol>
        </div>
      </div>

      {/* API test */}
      <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
        <h2 className="font-semibold text-foreground mb-3">Test Integration</h2>
        <p className="text-sm text-muted-foreground mb-4">After adding your API keys to Vercel and redeploying, use the Reminders page to send a test reminder to verify delivery.</p>
        <div className="flex gap-3">
          <a href="/reminders" className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted/40 transition-colors">
            Go to Reminders →
          </a>
          <a href="/automation" className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted/40 transition-colors">
            Manage Templates →
          </a>
        </div>
      </div>
    </div>
  );
}