import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { Database } from "@babun/shared/db/database.types";
import {
  loadEquipment,
  saveEquipment,
  type Equipment,
} from "@babun/shared/local/equipment";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";

export type { Equipment } from "@babun/shared/local/equipment";

// Inventory lives in the canonical public.equipment table (migration
// 20260624_001) so it syncs across devices and survives reinstalls.
// MMKV via the storage seam is only a write-through cache: reads fall
// back to it offline, saves refresh it before hitting Supabase.

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
  return useQuery({
    queryKey: ["equipment", tenantId],
    queryFn: async (): Promise<Equipment[]> => {
      if (tenantId) {
        try {
          // Fetch ALL rows (active + soft-deleted): an empty ACTIVE set is
          // ambiguous — «tenant never synced» (→ MMKV fallback) vs «user
          // deleted every item» (→ []). Soft-deleted rows prove the table
          // has synced, so a stale device cache must NOT resurrect items
          // removed on another device.
          const { data, error } = await supabase
            .from("equipment")
            .select("*")
            .eq("tenant_id", tenantId)
            .order("position");
          if (error) throw new Error(error.message);
          if (data.length > 0) {
            const list = data
              .filter((r) => r.is_active)
              .map(rowToEquipment);
            saveEquipment(list); // refresh the offline cache
            return list;
          }
          // No rows at all — pre-migration items live only in MMKV; show
          // them, the first save lifts them into Supabase.
        } catch {
          // offline — device cache below
        }
      }
      return loadEquipment();
    },
  });
}

export function useSaveEquipment() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      list,
      removeIds = [],
    }: {
      list: Equipment[];
      /** Ids the user explicitly deleted in THIS action. */
      removeIds?: string[];
    }) => {
      saveEquipment(list); // device cache first — offline safety
      if (tenantId) {
        if (list.length > 0) {
          const { error } = await supabase
            .from("equipment")
            .upsert(
              list.map((e, i) => toInsert(e, tenantId, i)),
              { onConflict: "tenant_id,id" },
            );
          if (error) throw new Error(error.message);
        }
        // Soft-delete ONLY what the user explicitly removed (is_active=
        // false, same pattern as the reference tables). Deriving deletions
        // from «rows missing from the snapshot» deactivated items created
        // concurrently on another device — the snapshot is a 30s-stale
        // cache or the offline fallback.
        if (removeIds.length > 0) {
          const { error: delErr } = await supabase
            .from("equipment")
            .update({ is_active: false })
            .eq("tenant_id", tenantId)
            .in("id", removeIds);
          if (delErr) throw new Error(delErr.message);
        }
      }
      return list;
    },
    onSuccess: (l) => qc.setQueryData(["equipment", tenantId], l),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}
