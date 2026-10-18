// Service-role Supabase client shared by the edge functions.
//
// Key choice (unchanged from the per-function copies it replaces):
// SUPABASE_SECRET_KEYS is a JSON object of keys; take the first string
// longer than 20 characters that starts with `sb_secret_`, else the first
// such string, else the legacy SUPABASE_SERVICE_ROLE_KEY. No key or no URL →
// null, and the caller answers with its own error.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.110.0";

export function keyFromEnv(envName: string, prefix: string): string | undefined {
  const raw = Deno.env.get(envName);
  if (!raw) return undefined;
  try {
    const keys = Object.values(JSON.parse(raw) as Record<string, unknown>).filter(
      (v): v is string => typeof v === "string" && v.length > 20,
    );
    return keys.find((v) => v.startsWith(prefix)) ?? keys[0];
  } catch {
    return undefined;
  }
}

export function serviceClient(): SupabaseClient | null {
  const url = Deno.env.get("SUPABASE_URL");
  const key =
    keyFromEnv("SUPABASE_SECRET_KEYS", "sb_secret_") ??
    (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || undefined);
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
