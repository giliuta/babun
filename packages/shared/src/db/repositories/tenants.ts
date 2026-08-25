// Tenants repository — STORY-041 G4.
//
// One row per registered user (owner_user_id), provisioned by the
// handle_new_user trigger on auth.users insert. The fields editable
// from /dashboard/settings/account live here: name, vertical, city.
// onboarded_at is also stamped here once but only by the wizard
// (STORY-040).
//
// RLS keys off public.current_tenant_id() for all writes; both update
// paths below filter by `id` so a user can only patch their own row.
// Service role bypass is intentionally out of scope — admin tasks
// (e.g. cascade-delete on account removal) belong in a separate
// server-only module that constructs a service-role Supabase client.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../database.types";

type DbSupabase = SupabaseClient<Database>;
type TenantRow = Database["public"]["Tables"]["tenants"]["Row"];

export type TenantUpdateFields = {
  name?: string;
  vertical?: string | null;
  city?: string | null;
};

export async function updateTenant(
  supabase: DbSupabase,
  tenantId: string,
  fields: TenantUpdateFields,
): Promise<TenantRow> {
  const patch: Database["public"]["Tables"]["tenants"]["Update"] = {};
  if (fields.name !== undefined) patch.name = fields.name;
  if (fields.vertical !== undefined) patch.vertical = fields.vertical;
  if (fields.city !== undefined) patch.city = fields.city;

  const { data, error } = await supabase
    .from("tenants")
    .update(patch)
    .eq("id", tenantId)
    .select("*")
    .single();
  if (error) throw new Error(`updateTenant: ${error.message}`);
  return data;
}
