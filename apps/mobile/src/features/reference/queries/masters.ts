import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { mastersQueryKey } from "@/lib/company-query-keys";
import { useDataRole, type UserRole } from "@/session/tenant";
import { operationalMasterJsonToMaster } from "@/features/settings/master-reference";
import { referenceKeys } from "../query-keys";
import type { Master } from "./types";

// ─── Masters ─────────────────────────────────────────────────────────
// `includeInactive` — список мастеров показывает архив (иначе «Вернуть из
// архива» в хабе недостижим); пикеры зовут без опции (паттерн useTeams).
/** Чтение мастеров ЧИСТОЙ функцией (см. `fetchTeams`): прогрев чужой компании
 *  зовёт её клиентом, привязанным к той компании (`bind-tenant.ts`). */
export async function fetchMasters(
  client: typeof supabase,
  tenantId: string,
  role: UserRole,
  includeInactive: boolean,
): Promise<Master[]> {
  if (role === "dispatcher" || role === "master") {
    const { data, error } = await client.rpc("list_operational_masters_safe");
    if (error) throw new Error(error.message);
    const rows = (data ?? []).map(operationalMasterJsonToMaster);
    return includeInactive ? rows : rows.filter((row) => row.is_active);
  }
  if (role !== "owner") throw new Error("Нет доступа к партнёрам");
  let q = client.from("masters").select("*").eq("tenant_id", tenantId);
  if (!includeInactive) q = q.eq("is_active", true);
  const { data, error } = await q.order("position");
  if (error) throw new Error(error.message);
  return data;
}

export function useMasters(opts?: { includeInactive?: boolean }) {
  const tenantId = useTenantId();
  const roleQuery = useDataRole();
  const role = roleQuery.data;
  const includeInactive = !!opts?.includeInactive;
  return useQuery({
    queryKey: mastersQueryKey(tenantId, role, includeInactive),
    enabled: !!tenantId && roleQuery.isSuccess && role != null,
    queryFn: () =>
      fetchMasters(supabase, tenantId as string, role as UserRole, includeInactive),
  });
}

// Single-master read for the master hub. See useTeam for the by-id rationale.
export function useMaster(id: string | undefined) {
  const tenantId = useTenantId();
  const roleQuery = useDataRole();
  return useQuery({
    queryKey: referenceKeys.master(tenantId, roleQuery.data, id),
    enabled: !!tenantId && !!id && roleQuery.isSuccess && roleQuery.data === "owner",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("masters")
        .select("*")
        .eq("tenant_id", tenantId as string)
        .eq("id", id as string)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
  });
}
