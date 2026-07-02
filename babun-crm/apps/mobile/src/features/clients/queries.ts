import { Alert } from "react-native";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createClient as createClientRepo,
  getClient,
  listClientTags,
  listClients,
  updateClient,
} from "@babun/shared/db/repositories/clients";
import { createBlankClient, type Client } from "@babun/shared/local/clients";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { tryToE164 } from "./phone";

// Clients list — TanStack Query on top of the shared Supabase repository
// (port-as-is). RLS scopes rows to the tenant; we pass tenantId for the index.
export function useClients() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["clients", tenantId],
    enabled: !!tenantId,
    queryFn: () => listClients(supabase, tenantId as string),
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
      return createClientRepo(supabase, createBlankClient(overrides), tenantId);
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
    queryFn: () => listClientTags(supabase, tenantId as string),
  });
}
