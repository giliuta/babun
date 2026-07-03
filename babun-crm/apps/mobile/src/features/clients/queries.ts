import { Alert } from "react-native";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
// STORY-062 slice 5 — clients + tags READS now go through the shared
// offline-aware SWR wrappers (listClients / listClientTags). The two slice-4
// blockers are both closed:
//   1. cache-of-DOMAIN — the wrapper stores the FULL Client (tag_ids + nested
//      phones/locations/notes/equipment) and returns it whole, so the online
//      warm-cache read is byte-identical to a live repo read (no stripped-row
//      regression on the tag facet / filter / card meta);
//   2. revalidate bridge — the wrapper's background revalidate now prunes
//      server-deleted rows (cacheReplaceTenant) and, on a real change, fires
//      `revalidated`, which the realtime bridge (SyncBridgeMount) turns into a
//      react-query invalidate so the list re-reads the freshened cache.
// Offline the warm cache serves the last snapshot; a cold offline read returns
// [] (empty state, not an error). `getClient` stays a direct repo read — the
// single-client card is not one of the three cached tables and must render the
// canonical row live.
import { getClient } from "@babun/shared/db/repositories/clients";
import {
  listClients as listClientsCached,
  createClient as createClientCached,
  updateClient,
  deleteClient as deleteClientCached,
} from "@babun/shared/sync/clientsCached";
import { listClientTags as listClientTagsCached } from "@babun/shared/sync/tagsCached";
import { createBlankClient, type Client } from "@babun/shared/local/clients";
import { randomUuid } from "@babun/shared/sync";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";

// Clients list — SWR wrapper read (full domain shape incl. tag_ids, served
// from the SQLite cache when warm, then revalidated). RLS scopes rows to the
// tenant; we pass tenantId for the query key and the RLS/cache filter.
export function useClients() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["clients", tenantId],
    enabled: !!tenantId,
    queryFn: () => listClientsCached(supabase, tenantId as string),
  });
}

export function useClient(id: string) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["client", id],
    enabled: !!tenantId && !!id,
    queryFn: () => getClient(supabase, id, tenantId as string),
  });
}

export function useUpdateClient(id: string) {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Client>) => {
      // Guard: never fire the PATCH with tenant_id=undefined (session not
      // resolved yet) — it would silently match nothing / hit RLS.
      if (!tenantId) throw new Error("Нет активного тенанта");
      return updateClient(supabase, id, patch, tenantId);
    },
    onSuccess: (updated) => {
      qc.setQueryData(["client", id], updated);
      // Blocks fire independent mutations (blur saves), so two PATCHes
      // can resolve out of order and the late response would overwrite
      // the newer field. Refetching settles the cache on the server's
      // authoritative row either way.
      qc.invalidateQueries({ queryKey: ["client", id] });
      qc.invalidateQueries({ queryKey: ["clients"] });
    },
    onError: (e) => {
      // The blocks keep edits in local drafts and never read isError —
      // without this a failed save is silently lost until remount.
      Alert.alert(
        "Не удалось сохранить",
        (e as Error).message || "Проверьте соединение и попробуйте ещё раз.",
      );
    },
  });
}

export function useCreateClient() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (overrides: Partial<Client>) => {
      if (!tenantId) throw new Error("Нет активного тенанта");
      // Offline-aware: wrapper writes the optimistic row to sqlite and either
      // hits the repo (online) or enqueues an insert op (offline), returning
      // the client-generated UUID either way.
      //
      // RN UUID guard: createBlankClient falls back to a NON-uuid `cli-…` id
      // when `crypto.randomUUID` is absent — which is EXACTLY the RN/Hermes
      // case (react-native-get-random-values only polyfills getRandomValues).
      // The wrapper keeps a supplied id verbatim (`id = input.id || …`), so a
      // `cli-…` id would flow into the offline queue and the replayer would
      // permanently-fail its update op (non-uuid row_id). Stamp a real RN-safe
      // UUID up front so the whole create→edit→replay chain stays consistent.
      const blank = createBlankClient(overrides);
      return createClientCached(supabase, { ...blank, id: randomUuid() }, tenantId);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["clients"] }),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}

// Bulk delete (clients list bulk-mode). Deletes each selected client
// through the SAME offline-aware wrapper the web «Удалить» uses
// (clientsCached.deleteClient): online it hits the repo + optimistically
// drops the cache row, offline it enqueues a delete op — so a bulk delete
// on a flaky connection degrades gracefully instead of half-failing. Runs
// in small parallel chunks and invalidates in onSettled, so a mid-batch
// failure still surfaces the rows that WERE removed. Errors are collected
// per-row (Promise.allSettled) rather than sinking the whole run on the
// first reject — parity with useImportRows — so the caller can report a
// partial result. The mutation itself never rejects when at least one row
// succeeded; the caller reads {deleted, failed} and messages accordingly.
//
// NB — HARD delete, matching web parity. The shared repo also exposes
// softDeleteClients (deleted_at), but the app-level «Удалить» on both web
// and mobile routes through the hard-delete wrapper today; junction rows
// cascade via FK. Switching the product to soft-delete is a separate,
// cross-platform decision, not a mobile-only divergence.
export interface DeleteClientsResult {
  deleted: number;
  failed: number;
}

export function useDeleteClients() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]): Promise<DeleteClientsResult> => {
      if (!tenantId) throw new Error("Нет активного тенанта");
      let deleted = 0;
      let failed = 0;
      const CHUNK = 8;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK);
        // Settle each so one bad row (repo error / RLS online) doesn't abort
        // the remaining chunks — count fulfilled vs rejected instead.
        const settled = await Promise.allSettled(
          chunk.map((id) => deleteClientCached(supabase, id, tenantId)),
        );
        for (const res of settled) {
          if (res.status === "fulfilled") deleted++;
          else failed++;
        }
      }
      return { deleted, failed };
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["clients"] }),
    meta: { errorHandled: true }, // caller messages the partial result itself
  });
}

export function useClientTags() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["client-tags", tenantId],
    enabled: !!tenantId,
    // SWR wrapper read (same as useClients): warm cache serves instantly, the
    // background revalidate prunes + emits, the realtime bridge re-reads.
    queryFn: () => listClientTagsCached(supabase, tenantId as string),
  });
}
