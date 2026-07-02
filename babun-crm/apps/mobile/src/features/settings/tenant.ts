import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { Database } from "@babun/shared/db/database.types";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";

export type Tenant = Database["public"]["Tables"]["tenants"]["Row"];
type TenantUpdate = Database["public"]["Tables"]["tenants"]["Update"];

// Mirrors the tenant_members CHECK constraint (20260430_008_team_roles.sql):
// role in ('owner','dispatcher','master').
export type UserRole = "owner" | "dispatcher" | "master";

// Role of the signed-in user within the active tenant (tenant_members via
// the current_user_role() RPC from 20260430_008). RLS gates tenants UPDATE
// to owner only — screens use this to disable what would fail anyway.
export function useCurrentRole() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["current-role", tenantId],
    enabled: !!tenantId,
    staleTime: Infinity,
    queryFn: async (): Promise<UserRole | null> => {
      const { data, error } = await supabase.rpc("current_user_role");
      if (error) throw new Error(error.message);
      return (data as UserRole | null) ?? null;
    },
  });
}

// PostgREST surfaces an RLS refusal as a raw English message — translate
// the common case so a dispatcher/master user sees why the save failed.
function friendlyTenantError(message: string): string {
  return /row-level security/i.test(message)
    ? "Недостаточно прав: изменять профиль бизнеса может только владелец."
    : message;
}

export function useTenant() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["tenant", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select("*")
        .eq("id", tenantId as string)
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
  });
}

export function useUpdateTenant() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: TenantUpdate) => {
      if (!tenantId) throw new Error("Нет активного тенанта");
      const { error, count } = await supabase
        .from("tenants")
        .update(patch, { count: "exact" })
        .eq("id", tenantId);
      if (error) throw new Error(friendlyTenantError(error.message));
      // RLS silently filters rows it refuses to update — 0 affected rows
      // for a non-owner is a permissions failure, not a success.
      if (count === 0)
        throw new Error(friendlyTenantError("row-level security"));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tenant"] }),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}
