import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Database } from "@babun/shared/db/database.types";
import {
  hasEquipmentCache,
  hasEquipmentServerSync,
  loadEquipment,
  markEquipmentServerSynced,
  saveEquipment,
  type Equipment,
} from "@babun/shared/local/equipment";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { isConfirmedNetworkUnavailable } from "@/features/settings/server-read-fallback";
import { useCurrentRole } from "@/features/settings/tenant";

export type { Equipment } from "@babun/shared/local/equipment";

// Inventory lives in the canonical public.equipment table (migration
// 20260624_001) so it syncs across devices and survives reinstalls.
// MMKV via the storage seam is only a tenant-scoped read cache. Canonical
// writes must succeed on Supabase before the cache/UI reports success.

type Row = Database["public"]["Tables"]["equipment"]["Row"];
type Insert = Database["public"]["Tables"]["equipment"]["Insert"];

function rowToEquipment(r: Row): Equipment {
  return {
    id: r.id,
    name: r.name,
    category: r.category ?? undefined,
    serial: r.serial ?? undefined,
    assigned_team_id: r.assigned_team_id,
    notes: r.notes ?? undefined,
    color: r.color ?? undefined,
    is_active: r.is_active,
    created_at: r.created_at,
    sort_order: r.position,
  };
}

function toInsert(e: Equipment, tenantId: string, position: number): Insert {
  return {
    id: e.id,
    tenant_id: tenantId,
    name: e.name,
    category: e.category ?? null,
    serial: e.serial ?? null,
    assigned_team_id: e.assigned_team_id,
    notes: e.notes ?? null,
    color: e.color ?? null,
    position,
    is_active: true,
  };
}

export function useEquipment() {
  const tenantId = useTenantId();
  const roleQuery = useCurrentRole();
  const role = roleQuery.data;
  const visibilityScope = role === "master" ? "master" : undefined;
  return useQuery({
    queryKey: ["equipment", tenantId, role ?? "role-pending"],
    enabled: !!tenantId && roleQuery.isSuccess && role != null,
    queryFn: async (): Promise<Equipment[]> => {
      if (!tenantId) throw new Error("Нет активного тенанта");
      const { data, error } = await supabase
        .from("equipment")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("position");

      if (error) {
        if (!isConfirmedNetworkUnavailable(error)) {
          throw new Error(error.message);
        }
        // A warm, tenant-scoped snapshot may keep the screen usable offline.
        // Cold offline must stay an error instead of masquerading as «склад
        // пуст»; a successful canonical [] is marked and remains valid.
        if (
          hasEquipmentServerSync(tenantId, visibilityScope) ||
          hasEquipmentCache(tenantId, visibilityScope)
        ) {
          return loadEquipment(tenantId, visibilityScope);
        }
        throw new Error("Нет сети и склад ещё не загружен на это устройство");
      }

      const list = data.filter((r) => r.is_active).map(rowToEquipment);
      saveEquipment(list, tenantId, visibilityScope);
      markEquipmentServerSynced(tenantId, visibilityScope);
      return list;
    },
  });
}

export function useSaveEquipment() {
  const tenantId = useTenantId();
  const role = useCurrentRole().data;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      list,
      removeIds = [],
      upsertIds,
    }: {
      list: Equipment[];
      /** Ids the user explicitly deleted in THIS action. */
      removeIds?: string[];
      /** Rows changed by this action. Omitted only for legacy bulk saves. */
      upsertIds?: string[];
    }) => {
      if (!tenantId) throw new Error("Нет активного тенанта");
      if (role !== "owner") {
        throw new Error("Изменять склад может только владелец.");
      }
      const changed = upsertIds
        ? list.filter((item) => upsertIds.includes(item.id))
        : list;
      if (changed.length > 0) {
        const positions = new Map(list.map((item, index) => [item.id, index]));
        const { data, error } = await supabase
          .from("equipment")
          .upsert(
            changed.map((e) =>
              toInsert(e, tenantId, positions.get(e.id) ?? list.length),
            ),
            { onConflict: "tenant_id,id" },
          )
          .select("id");
        if (error) throw new Error(error.message);
        if ((data ?? []).length !== changed.length) {
          throw new Error("Не все позиции склада были сохранены.");
        }
      }
      // Soft-delete ONLY what the user explicitly removed (is_active=
      // false, same pattern as the reference tables). Deriving deletions
      // from «rows missing from the snapshot» deactivated items created
      // concurrently on another device — the snapshot is a 30s-stale
      // cache or the offline fallback.
      if (removeIds.length > 0) {
        const { data: deleted, error: delErr } = await supabase
          .from("equipment")
          .update({ is_active: false })
          .eq("tenant_id", tenantId)
          .in("id", removeIds)
          .select("id");
        if (delErr) throw new Error(delErr.message);
        if ((deleted ?? []).length !== removeIds.length) {
          throw new Error("Не все позиции склада были удалены.");
        }
      }
      saveEquipment(list, tenantId);
      markEquipmentServerSynced(tenantId);
      return list;
    },
    onSuccess: (l) => qc.setQueryData(["equipment", tenantId, role], l),
    onSettled: () =>
      qc.invalidateQueries({ queryKey: ["equipment", tenantId] }),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}
