// ── Customer matching / creation for imports ────────────────────────────
// Loan and investment files reference customers by name/phone/email, not by
// internal ID — this resolver is the single place that decides "is this an
// existing customer or a new one" so both import flows behave identically
// and we never silently create duplicate customer records.
//
// Match order: phone (exact) → email (exact, case-insensitive) → normalised
// full name (exact, case-insensitive). Phone/email are far more reliable
// identifiers than name, so they're tried first.
//
// When a match is found, any contact detail present in the file but missing
// on the existing record (e.g. the file has an email the system didn't have
// yet) is backfilled — never overwritten if the existing value is already set,
// so a later, less-complete file can't blank out good data.

import { supabase } from "@/lib/supabase/client";

export type CustomerResolution = {
  customerId: string;
  action: "created" | "updated" | "matched";
};

interface CustomerInput {
  name: string;
  phone?: string;
  email?: string;
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function resolveOrCreateCustomer(input: CustomerInput, rowSeed: string): Promise<CustomerResolution | null> {
  const name = input.name?.trim();
  const phone = input.phone?.trim() || undefined;
  const email = input.email?.trim().toLowerCase() || undefined;

  if (!name && !phone && !email) return null;

  let existing: { id: string; phone: string | null; email: string | null; full_name: string } | null = null;

  if (phone) {
    const { data } = await supabase.from("customers").select("id, phone, email, full_name").eq("phone", phone).limit(1).maybeSingle();
    if (data) existing = data;
  }
  if (!existing && email) {
    const { data } = await supabase.from("customers").select("id, phone, email, full_name").ilike("email", email).limit(1).maybeSingle();
    if (data) existing = data;
  }
  if (!existing && name) {
    const { data } = await supabase.from("customers").select("id, phone, email, full_name").ilike("full_name", normalizeName(name)).limit(1).maybeSingle();
    if (data) existing = data;
  }

  if (existing) {
    const patch: { email?: string; phone?: string } = {};
    if (email && !existing.email) patch.email = email;
    if (phone && (!existing.phone || existing.phone === "N/A")) patch.phone = phone;

    if (Object.keys(patch).length > 0) {
      await supabase.from("customers").update(patch).eq("id", existing.id);
      return { customerId: existing.id, action: "updated" };
    }
    return { customerId: existing.id, action: "matched" };
  }

  const { data: created, error } = await supabase
    .from("customers")
    .insert({
      customer_code: `CUS-IMP-${rowSeed}`,
      full_name: name || "Unknown",
      phone: phone || "N/A",
      email: email || null,
      date_joined: new Date().toISOString().slice(0, 10),
      status: "active",
    })
    .select("id")
    .single();

  if (error || !created) return null;
  return { customerId: created.id, action: "created" };
}
