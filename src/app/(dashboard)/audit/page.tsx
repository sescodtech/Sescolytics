"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { formatDateTime } from "@/lib/utils";
import { Search, ShieldCheck } from "lucide-react";

export default function AuditPage() {
  const [search, setSearch] = useState("");

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ["audit-logs"],
    queryFn: async () => {
      const { data } = await supabase
        .from("audit_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      return data ?? [];
    },
  });

  const filtered = logs.filter(l =>
    l.action.toLowerCase().includes(search.toLowerCase()) ||
    (l.user_email ?? "").toLowerCase().includes(search.toLowerCase()) ||
    (l.entity_type ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const getActionColor = (action: string) => {
    if (action.includes("delete") || action.includes("remove")) return "bg-red-100 text-red-800";
    if (action.includes("create") || action.includes("insert") || action.includes("add")) return "bg-green-100 text-green-800";
    if (action.includes("update") || action.includes("edit")) return "bg-blue-100 text-blue-800";
    if (action.includes("login") || action.includes("auth")) return "bg-purple-100 text-purple-800";
    return "bg-gray-100 text-gray-700";
  };

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="Audit Log" description={`${logs.length} activity records`} />

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by action, user, or entity type..."
          className="w-full pl-9 pr-4 py-2.5 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 bg-card" />
      </div>

      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">Timestamp</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">User</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">Action</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">Entity</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">IP Address</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>{Array.from({ length: 5 }).map((_, j) => (
                    <td key={j} className="px-5 py-3"><div className="h-4 bg-muted animate-pulse rounded" /></td>
                  ))}</tr>
                ))
              ) : filtered.map(log => (
                <tr key={log.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-5 py-3 text-muted-foreground text-xs font-mono">{formatDateTime(log.created_at)}</td>
                  <td className="px-5 py-3">
                    <div>
                      <p className="font-medium text-foreground text-xs">{log.user_email ?? "System"}</p>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getActionColor(log.action)}`}>
                      {log.action}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-muted-foreground text-xs">
                    {log.entity_type ? <span className="font-medium text-foreground">{log.entity_type}</span> : "—"}
                    {log.entity_id && <span className="text-muted-foreground"> · {log.entity_id.slice(0, 8)}…</span>}
                  </td>
                  <td className="px-5 py-3 text-muted-foreground text-xs font-mono">{log.ip_address ?? "—"}</td>
                </tr>
              ))}
              {!isLoading && filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-16 text-center">
                    <ShieldCheck className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
                    <p className="text-muted-foreground">No audit logs found</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-3 border-t border-border text-xs text-muted-foreground">
          Showing {filtered.length} of {logs.length} records
        </div>
      </div>
    </div>
  );
}
