"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { formatDate } from "@/lib/utils";
import { UserPlus, Shield, X, Trash2, CheckCircle, XCircle } from "lucide-react";
import { toast } from "sonner";

const ALL_ROLES = [
  "super_admin", "branch_manager", "collection_officer",
  "investment_officer", "auditor"
] as const;
type AppRole = typeof ALL_ROLES[number];

type Profile = {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  active: boolean;
  created_at: string;
};

function InviteModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [selectedRoles, setSelectedRoles] = useState<AppRole[]>(["collection_officer"]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!email || !password || !fullName) throw new Error("All fields are required");
      if (password.length < 8) throw new Error("Password must be at least 8 characters");

      // Create user via Supabase Admin (uses service role — works only if called from a trusted context)
      // Since we're client-side, we use signUp then immediately update profile
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName } },
      });
      if (error) throw error;
      if (!data.user) throw new Error("Failed to create user");

      // Update profile
      await supabase.from("profiles").upsert({
        id: data.user.id,
        full_name: fullName,
        email,
        active: true,
      });

      // Assign roles
      for (const role of selectedRoles) {
        await supabase.from("user_roles").insert({ user_id: data.user.id, role });
      }
    },
    onSuccess: () => {
      toast.success("User created successfully. They can now log in.");
      queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.invalidateQueries({ queryKey: ["all-roles"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleRole = (role: AppRole) => {
    setSelectedRoles(prev =>
      prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role]
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-card rounded-xl shadow-xl w-full max-w-md border border-border">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="font-semibold text-foreground">Add New User</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1.5">Full Name *</label>
            <input type="text" value={fullName} onChange={e => setFullName(e.target.value)}
              placeholder="e.g. Amina Bello"
              className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">Email Address *</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="e.g. amina@charisbank.com"
              className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">Temporary Password *</label>
            <input type="text" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="Min 8 characters — share with user to change"
              className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Roles</label>
            <div className="grid grid-cols-2 gap-2">
              {ALL_ROLES.map(role => (
                <button key={role} onClick={() => toggleRole(role)}
                  className={`px-3 py-2 rounded-lg border text-xs font-medium text-left transition-all ${selectedRoles.includes(role) ? "border-primary bg-primary/10 text-primary" : "border-border hover:border-primary/30"}`}>
                  {role.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex gap-3 px-6 py-4 border-t border-border">
          <button onClick={onClose} className="flex-1 py-2.5 border border-border rounded-lg text-sm font-medium hover:bg-muted/40">Cancel</button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending}
            className="flex-1 py-2.5 brand-gradient text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-60">
            {mutation.isPending ? "Creating..." : "Create User"}
          </button>
        </div>
      </div>
    </div>
  );
}

function RoleModal({ user, currentRoles, onClose }: {
  user: Profile;
  currentRoles: AppRole[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [roles, setRoles] = useState<AppRole[]>(currentRoles);

  const mutation = useMutation({
    mutationFn: async () => {
      // Remove all current roles
      await supabase.from("user_roles").delete().eq("user_id", user.id);
      // Insert new ones
      for (const role of roles) {
        await supabase.from("user_roles").insert({ user_id: user.id, role });
      }
    },
    onSuccess: () => {
      toast.success("Roles updated");
      queryClient.invalidateQueries({ queryKey: ["all-roles"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = (role: AppRole) => {
    setRoles(prev => prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role]);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-card rounded-xl shadow-xl w-full max-w-sm border border-border">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="font-semibold text-foreground">Edit Roles</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{user.full_name}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 gap-2">
            {ALL_ROLES.map(role => (
              <button key={role} onClick={() => toggle(role)}
                className={`flex items-center justify-between px-4 py-3 rounded-lg border text-sm font-medium transition-all ${roles.includes(role) ? "border-primary bg-primary/10 text-primary" : "border-border hover:border-primary/30"}`}>
                {role.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
                {roles.includes(role) && <CheckCircle className="w-4 h-4" />}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-3 px-6 py-4 border-t border-border">
          <button onClick={onClose} className="flex-1 py-2.5 border border-border rounded-lg text-sm font-medium hover:bg-muted/40">Cancel</button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending}
            className="flex-1 py-2.5 brand-gradient text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-60">
            {mutation.isPending ? "Saving..." : "Save Roles"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function UsersPage() {
  const queryClient = useQueryClient();
  const [showInvite, setShowInvite] = useState(false);
  const [roleTarget, setRoleTarget] = useState<Profile | null>(null);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["users"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("*").order("created_at", { ascending: false });
      return (data ?? []) as Profile[];
    },
  });

  const { data: allRoles = [] } = useQuery({
    queryKey: ["all-roles"],
    queryFn: async () => {
      const { data } = await supabase.from("user_roles").select("user_id, role");
      return data ?? [];
    },
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.from("profiles").update({ active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("User status updated");
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });

  const getUserRoles = (userId: string): AppRole[] =>
    allRoles.filter(r => r.user_id === userId).map(r => r.role as AppRole);

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="User Management" description={`${users.length} system users`}>
        <button onClick={() => setShowInvite(true)}
          className="flex items-center gap-2 px-4 py-2 brand-gradient text-white rounded-lg text-sm font-medium hover:opacity-90">
          <UserPlus className="w-4 h-4" /> Add User
        </button>
      </PageHeader>

      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">Name</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">Email</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">Roles</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">Joined</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">Status</th>
                <th className="text-center px-5 py-3 text-xs font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>{Array.from({ length: 6 }).map((_, j) => (
                    <td key={j} className="px-5 py-3"><div className="h-4 bg-muted animate-pulse rounded" /></td>
                  ))}</tr>
                ))
              ) : users.map(user => {
                const userRoles = getUserRoles(user.id);
                return (
                  <tr key={user.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full brand-gradient flex items-center justify-center flex-shrink-0">
                          <span className="text-xs font-bold text-white">{user.full_name.charAt(0)}</span>
                        </div>
                        <span className="font-medium text-foreground">{user.full_name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{user.email}</td>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap gap-1">
                        {userRoles.length > 0 ? userRoles.map(r => (
                          <span key={r} className="px-2 py-0.5 bg-primary/10 text-primary rounded-full text-xs font-medium">
                            {r.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
                          </span>
                        )) : <span className="text-xs text-muted-foreground">No roles</span>}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{formatDate(user.created_at)}</td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${user.active ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-700"}`}>
                        {user.active ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                        {user.active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-center gap-2">
                        <button onClick={() => setRoleTarget(user)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors">
                          <Shield className="w-3 h-3" /> Roles
                        </button>
                        <button
                          onClick={() => toggleActive.mutate({ id: user.id, active: !user.active })}
                          className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${user.active ? "bg-red-50 text-red-700 hover:bg-red-100" : "bg-green-50 text-green-700 hover:bg-green-100"}`}>
                          {user.active ? "Deactivate" : "Activate"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!isLoading && users.length === 0 && (
                <tr><td colSpan={6} className="px-5 py-10 text-center text-muted-foreground">No users yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showInvite && <InviteModal onClose={() => setShowInvite(false)} />}
      {roleTarget && (
        <RoleModal
          user={roleTarget}
          currentRoles={getUserRoles(roleTarget.id)}
          onClose={() => setRoleTarget(null)}
        />
      )}
    </div>
  );
}
