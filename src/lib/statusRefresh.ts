// ── Keep loan/investment status columns live ────────────────────────────
// `loans.status` (active/due_today/due_tomorrow/overdue) and
// `investments.status` are computed columns, refreshed by the
// `refresh_loan_statuses()` / `refresh_investment_statuses()` Postgres
// functions (see schema.sql). Those were only ever run ONCE, during the
// initial schema setup — there's no daily cron calling them again, so as
// due_dates pass, `status` silently goes stale: a loan that's actually
// overdue can sit at status = 'active' indefinitely.
//
// That single stale column is why "overdue" reminders, collections, and
// dashboard counts can all quietly stop reflecting reality at the same
// time — every one of those views filters on `status`.
//
// Fix: call the refresh functions ourselves right before any query that
// depends on live status, instead of assuming a cron job exists. Throttled
// so it doesn't re-run on every re-render.

import { supabase } from "@/lib/supabase/client";

let lastRefresh = 0;
const REFRESH_INTERVAL_MS = 30_000;

export async function ensureStatusesFresh(): Promise<void> {
  const now = Date.now();
  if (now - lastRefresh < REFRESH_INTERVAL_MS) return;
  lastRefresh = now;
  try {
    await Promise.all([
      supabase.rpc("refresh_loan_statuses"),
      supabase.rpc("refresh_investment_statuses"),
    ]);
  } catch (err) {
    // Best-effort — if the RPC isn't reachable, queries still run, just
    // against whatever status was last written.
    console.warn("Status refresh failed:", err);
  }
}
