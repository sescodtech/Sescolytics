// ── Configurable app branding ────────────────────────────────────────────
// Backed by the `system_settings` key/value table. Nothing in the UI should
// hard-code "ILRMS" or "Charis Microfinance Bank" — components read these
// values (with sensible fallbacks while loading) so an admin can rebrand
// the whole app from Settings → General without a code change.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";

import type { Json } from "@/lib/supabase/types";

export interface AppSettings {
  appName: string;
  orgName: string;
  logoUrl: string | null;
}

const DEFAULTS: AppSettings = {
  appName: "ILRMS",
  orgName: "Charis Microfinance Bank",
  logoUrl: null,
};

const KEYS = ["app_name", "org_name", "logo_url"] as const;

export function useAppSettings() {
  return useQuery({
    queryKey: ["app-settings"],
    queryFn: async (): Promise<AppSettings> => {
      const { data, error } = await supabase.from("system_settings").select("key, value").in("key", KEYS as unknown as string[]);
      if (error || !data) return DEFAULTS;
      const map = new Map(data.map((r) => [r.key, r.value]));
      return {
        appName: (map.get("app_name") as string) || DEFAULTS.appName,
        orgName: (map.get("org_name") as string) || DEFAULTS.orgName,
        logoUrl: (map.get("logo_url") as string | null) ?? null,
      };
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useUpdateAppSettings() {
  const queryClient = useQueryClient();
  return async (patch: Partial<AppSettings>) => {
    const { data: userData } = await supabase.auth.getUser();
    const rows: { key: string; value: Json; updated_by: string | null }[] = [];
    if (patch.appName !== undefined) rows.push({ key: "app_name", value: patch.appName, updated_by: userData?.user?.id ?? null });
    if (patch.orgName !== undefined) rows.push({ key: "org_name", value: patch.orgName, updated_by: userData?.user?.id ?? null });
    if (patch.logoUrl !== undefined) rows.push({ key: "logo_url", value: patch.logoUrl, updated_by: userData?.user?.id ?? null });
    if (!rows.length) return;
    const { error } = await supabase.from("system_settings").upsert(rows, { onConflict: "key" });
    if (error) throw error;
    queryClient.invalidateQueries({ queryKey: ["app-settings"] });
  };
}
