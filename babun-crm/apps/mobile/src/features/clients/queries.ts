import { Alert } from "react-native";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
// STORY-062 slice 4 — clients + tags WRITES go through the shared offline-aware
// cache wrappers (optimistic sqlite write, then online→repo / offline→enqueue).
// READS stay on the repo: the SWR list wrapper's warm-cache branch returns a
// STRIPPED sqlite row (tag_ids/phones/locations/notes/equipment all []) and
// only revalidates into sqlite — it never re-hydrates the react-query cache
// (mobile has no realtime bridge like the web's useRealtimeTenantSync). So the
// online list would silently lose tag_ids (breaking the tag facet / filter /
// card meta) and never recover. repoListClients/repoListClientTags return the
// FULL domain shape and every fetch is authoritative & fresh. `getClient`
// likewise stays a direct repo read — the card must render the canonical row,
// not a stripped offline one.
import {
  getClient,
  listClients as repoListClients,
  listClientTags as repoListClientTags,
  createClient as createClientRepo,
} from "@babun/shared/db/repositories/clients";
import {
  createClient as createClientCached,
  updateClient,
} from "@babun/shared/sync/clientsCached";
import { createBlankClient, type Client } from "@babun/shared/local/clients";
import { randomUuid } from "@babun/shared/sync";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { tryToE164 } from "./phone";

// Clients list — repo read (full domain shape incl. tag_ids). RLS scopes rows
// to the tenant; we pass tenantId for the query key and the RLS filter.
export function useClients() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["clients", tenantId],
    enabled: !!tenantId,
    queryFn: () => repoListClients(supabase, tenantId as string),
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

// Bulk import (CSV). Normalizes each draft's phone to E.164 (so the
// web dedup guard keeps working on mobile-imported rows), skips drafts
// whose number already exists — in the cached list or earlier in the
// same file — and creates the rest through the shared repo in small
// parallel chunks (500 strictly sequential round-trips took minutes).
// Invalidates in onSettled so a mid-file failure still surfaces the
// rows that WERE created, and a retry skips them as duplicates.
//
// STORY-062 slice 4 — bulk import stays ONLINE-ONLY on the direct repo
// (createClientRepo), matching the web (apps/web/.../import/csv-import.ts
// batch-inserts straight into supabase, bypassing clientsCached). Routing
// hundreds of CSV rows through the offline wrapper would enqueue hundreds
// of insert ops + per-row sqlite upserts on a flaky connection — the wrong
// shape for a bulk operation the user runs deliberately while connected.
// A cold import with no network simply fails and the ImportSheet alerts.
export function useImportClients() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      drafts,
      onProgress,
    }: {
      drafts: Partial<Client>[];
      onProgress?: (done: number, total: number) => void;
    }): Promise<{ created: number; duplicates: number }> => {
      if (!tenantId) throw new Error("Нет активного тенанта");
      const cached = qc.getQueryData<Client[]>(["clients", tenantId]) ?? [];
      const seen = new Set<string>();
      for (const c of cached) {
        const key = c.phone_e164 ?? tryToE164(c.phone ?? "");
        if (key) seen.add(key);
      }

      let duplicates = 0;
      const queue: Partial<Client>[] = [];
      for (const d of drafts) {
        const e164 = tryToE164(d.phone ?? "");
        if (e164) {
          if (seen.has(e164)) {
            duplicates++;
            continue;
          }
          seen.add(e164);
        }
        queue.push({ ...d, phone_e164: e164 });
      }

      let created = 0;
      const CHUNK = 10;
      for (let i = 0; i < queue.length; i += CHUNK) {
        const chunk = queue.slice(i, i + CHUNK);
        await Promise.all(
          chunk.map((d) =>
            createClientRepo(supabase, createBlankClient(d), tenantId),
          ),
        );
        created += chunk.length;
        onProgress?.(created, queue.length);
      }
      return { created, duplicates };
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["clients"] }),
    meta: { errorHandled: true }, // ImportSheet alerts itself
  });
}

export function useClientTags() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["client-tags", tenantId],
    enabled: !!tenantId,
    // Repo read (same reason as useClients): the tags SWR wrapper warm-cache
    // branch only revalidates sqlite and never re-hydrates this query cache.
    queryFn: () => repoListClientTags(supabase, tenantId as string),
  });
}
