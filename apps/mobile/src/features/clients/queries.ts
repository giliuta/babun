import { Alert, Linking } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
// Offline the warm cache serves the last snapshot; a cold offline read is a
// typed blocking error, never a false empty customer base. `getClient` stays a direct repo read — the
// single-client card is not one of the three cached tables and must render the
// canonical row live.
import {
  getClient,
  purgeDateFromNow,
} from "@babun/shared/db/repositories/clients";
import {
  listClients as listClientsCached,
  listArchivedClients as listArchivedCached,
  listTrashedClients as listTrashedCached,
  createClient as createClientCached,
  updateClient,
  archiveClient as archiveClientCached,
  restoreClient as restoreClientCached,
  deleteClient as deleteClientCached,
} from "@babun/shared/sync/clientsCached";
import {
  createClientTag as createClientTagCached,
  deleteClientTag as deleteClientTagCached,
  listClientTags as listClientTagsCached,
  updateClientTag as updateClientTagCached,
} from "@babun/shared/sync/tagsCached";
import {
  createBlankClient,
  type Client,
  type ClientTag,
} from "@babun/shared/local/clients";
import { isOnline, randomUuid } from "@babun/shared/sync";
import { supabase } from "@/lib/supabase";
import { preflightQuotaForCreate } from "@/lib/quota";
import { useTenantId } from "@/lib/tenant";
import { useCurrentRole, type UserRole } from "@/features/settings/tenant";
import { masterClientJsonToClient } from "@/features/settings/master-reference";
import { isConfirmedNetworkUnavailable } from "@/features/settings/server-read-fallback";
import {
  cancelClientReminder,
  syncClientReminder,
  type ClientReminderResult,
} from "@/features/clients/reminders";

function surfaceClientReminderResult(result: ClientReminderResult): void {
  if (result === "scheduled" || result === "cleared") return;
  if (result === "denied") {
    Alert.alert(
      "Дата сохранена",
      "Уведомление не запланировано, потому что оно выключено для Babun в настройках iPhone.",
      [
        { text: "Позже", style: "cancel" },
        {
          text: "Открыть настройки",
          onPress: () => void Linking.openSettings(),
        },
      ],
    );
    return;
  }
  if (result === "deferred") {
    Alert.alert(
      "Дата сохранена",
      "Напоминание сохранено в очереди и установится, когда на iPhone освободится место.",
    );
    return;
  }
  if (result === "capacity") {
    Alert.alert(
      "Дата сохранена",
      "Очередь напоминаний переполнена. Удалите ненужные напоминания и сохраните дату ещё раз.",
    );
    return;
  }
  Alert.alert(
    "Дата сохранена",
    result === "past"
      ? "Эта дата уже прошла, поэтому системное уведомление не создавалось."
      : "Системное уведомление не удалось создать. Обновите приложение и повторите попытку.",
  );
}

function syncClientReminderWithFeedback(client: Client): void {
  void syncClientReminder(client).then(surfaceClientReminderResult);
}

/** Экспортирован для label-auto-assign: чтение списка из кэша без хука. */
export function clientsQueryKey(
  tenantId: string | null,
  role: UserRole | null | undefined,
) {
  return ["clients", tenantId, role ?? "role-pending"] as const;
}

function clientQueryKey(
  id: string,
  tenantId: string | null,
  role: UserRole | null | undefined,
) {
  return ["client", id, tenantId, role ?? "role-pending"] as const;
}

function clientTagsQueryKey(
  tenantId: string | null,
  role: UserRole | null | undefined,
) {
  return ["client-tags", tenantId, role ?? "role-pending"] as const;
}

async function listMasterClientsSafe(clientId?: string): Promise<Client[]> {
  const { data, error } = await supabase.rpc("list_master_clients_safe", {
    ...(clientId ? { p_client_id: clientId } : {}),
  });
  if (error) throw new Error(`listMasterClientsSafe: ${error.message}`);
  return (data ?? []).map(masterClientJsonToClient);
}

// Clients list — SWR wrapper read (full domain shape incl. tag_ids, served
// from the SQLite cache when warm, then revalidated). RLS scopes rows to the
// tenant; we pass tenantId for the query key and the RLS/cache filter.
export function useClients() {
  const tenantId = useTenantId();
  const roleQuery = useCurrentRole();
  const role = roleQuery.data;
  return useQuery({
    queryKey: clientsQueryKey(tenantId, role),
    enabled: !!tenantId && roleQuery.isSuccess && role != null,
    queryFn: () =>
      role === "master"
        ? listMasterClientsSafe()
        : listClientsCached(supabase, tenantId as string),
  });
}

export function useClient(id: string) {
  const tenantId = useTenantId();
  const roleQuery = useCurrentRole();
  const role = roleQuery.data;
  const qc = useQueryClient();
  return useQuery({
    queryKey: clientQueryKey(id, tenantId, role),
    enabled: !!tenantId && !!id && roleQuery.isSuccess && role != null,
    placeholderData: () => {
      const list = qc.getQueryData<Client[]>(clientsQueryKey(tenantId, role));
      return list?.find((client) => client.id === id);
    },
    queryFn: async () => {
      if (role === "master") {
        return (await listMasterClientsSafe(id))[0] ?? null;
      }
      try {
        return await getClient(supabase, id, tenantId as string);
      } catch (error) {
        const serverError =
          error && typeof error === "object"
            ? (error as { code?: string; message?: string })
            : { message: String(error) };
        if (!isConfirmedNetworkUnavailable(serverError)) throw error;
        // The list is offline-aware and may already have the complete domain
        // client in SQLite. A connection loss after opening the list should
        // therefore keep the card usable instead of becoming «not found».
        const cached = await listClientsCached(supabase, tenantId as string);
        const client = cached.find((item) => item.id === id);
        if (client) return client;
        throw error;
      }
    },
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
    onSuccess: (updated, patch) => {
      qc.setQueriesData({ queryKey: ["client", id] }, updated);
      // Blocks fire independent mutations (blur saves), so two PATCHes
      // can resolve out of order and the late response would overwrite
      // the newer field. Refetching settles the cache on the server's
      // authoritative row either way.
      qc.invalidateQueries({ queryKey: ["client", id] });
      qc.invalidateQueries({ queryKey: ["clients"] });
      if (patch.reminder_at !== undefined) {
        syncClientReminderWithFeedback(updated);
      }
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

// Как useUpdateClient, но id приходит с вызовом — для действий по строке
// СПИСКА (long-press меню: закрепить, напомнить), где хук на каждый ряд
// не заведёшь. Семантика кэша и ошибок — та же.
export function useUpdateClientById() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Client> }) => {
      if (!tenantId) throw new Error("Нет активного тенанта");
      return updateClient(supabase, id, patch, tenantId);
    },
    onSuccess: (updated, { id, patch }) => {
      qc.setQueriesData({ queryKey: ["client", id] }, updated);
      qc.invalidateQueries({ queryKey: ["client", id] });
      qc.invalidateQueries({ queryKey: ["clients"] });
      if (patch.reminder_at !== undefined) {
        syncClientReminderWithFeedback(updated);
      }
    },
    onError: (e) => {
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
    mutationFn: async (overrides: Partial<Client>) => {
      if (!tenantId) throw new Error("Нет активного тенанта");
      await preflightQuotaForCreate(supabase, tenantId, "clients", {
        online: isOnline(),
        isNetworkUnavailable: (error) =>
          isConfirmedNetworkUnavailable(
            error && typeof error === "object"
              ? (error as { code?: string; message?: string; details?: string })
              : { message: String(error) },
          ),
      });
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
      return createClientCached(
        supabase,
        { ...blank, id: randomUuid() },
        tenantId,
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["clients"] }),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}

// Bulk archive (clients list bulk-mode). Every selected client keeps its
// appointments, invoices and ledger context. Online we soft-delete with
// deleted_at; offline we enqueue an UPDATE and optimistically remove the row
// from the active-list cache. Runs
// in small parallel chunks and invalidates in onSettled, so a mid-batch
// failure still surfaces the rows that WERE removed. Errors are collected
// per-row (Promise.allSettled) rather than sinking the whole run on the
// first reject — parity with useImportRows — so the caller can report a
// partial result. The mutation itself never rejects when at least one row
// succeeded; the caller reads {deleted, failed} and messages accordingly.
//
export interface ArchiveClientsResult {
  archived: number;
  failed: number;
  archivedIds: string[];
}

/** `trash: true` — клиент едет в «Недавно удалённые» со сроком 30 дней;
 *  иначе в архив без срока. Одна мутация на обе полки: разница между ними
 *  и в базе ровно одна — проставлен ли `purge_at`. */
export interface ArchiveClientsInput {
  ids: string[];
  trash?: boolean;
}

export function useArchiveClients() {
  const tenantId = useTenantId();
  const roleQuery = useCurrentRole();
  const role = roleQuery.data;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: ArchiveClientsInput,
    ): Promise<ArchiveClientsResult> => {
      const { ids, trash } = input;
      if (!tenantId) throw new Error("Нет активного тенанта");
      if (role !== "owner" && role !== "dispatcher") {
        throw new Error("Архивировать клиентов может владелец или диспетчер.");
      }
      // Один срок на весь заход: клиенты, удалённые одним действием, должны
      // и стереться вместе, а не расползтись по секундам.
      const purgeAt = trash ? purgeDateFromNow() : null;
      let archived = 0;
      let failed = 0;
      const archivedIds: string[] = [];
      const CHUNK = 8;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK);
        // Settle each so one bad row (repo error / RLS online) doesn't abort
        // the remaining chunks — count fulfilled vs rejected instead.
        const settled = await Promise.allSettled(
          chunk.map((id) => archiveClientCached(supabase, id, tenantId, purgeAt)),
        );
        for (const [index, res] of settled.entries()) {
          if (res.status === "fulfilled") {
            archived++;
            archivedIds.push(chunk[index]);
          } else failed++;
        }
      }
      return { archived, failed, archivedIds };
    },
    onSuccess: ({ archivedIds }) => {
      void Promise.all(archivedIds.map(cancelClientReminder));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["clients"] });
      void qc.invalidateQueries({ queryKey: ["archived-clients"] });
      void qc.invalidateQueries({ queryKey: ["trashed-clients"] });
    },
    meta: { errorHandled: true }, // caller messages the partial result itself
  });
}

/** Архив и корзина ЧИТАЮТСЯ ИЗ КЭША (как рабочий список), а не напрямую с
 *  сервера. Прямое чтение было дырой: архивация, ушедшая в очередь, делала
 *  клиента невидимым везде — из списка его убрали, а сервер ещё считал
 *  живым, и экран архива о нём не знал. */
function useHiddenClients(
  key: "archived-clients" | "trashed-clients",
  read: (client: typeof supabase, tenantId: string) => Promise<Client[]>,
) {
  const tenantId = useTenantId();
  const roleQuery = useCurrentRole();
  const role = roleQuery.data;
  return useQuery({
    queryKey: [key, tenantId, role ?? "role-pending"],
    enabled:
      !!tenantId &&
      roleQuery.isSuccess &&
      (role === "owner" || role === "dispatcher"),
    queryFn: () => read(supabase, tenantId as string),
  });
}

/** Архив: убраны из работы бессрочно. */
export function useArchivedClients() {
  return useHiddenClients("archived-clients", listArchivedCached);
}

/** «Недавно удалённые»: сотрутся по своему сроку. */
export function useTrashedClients() {
  return useHiddenClients("trashed-clients", listTrashedCached);
}

export function useRestoreClient() {
  const tenantId = useTenantId();
  const roleQuery = useCurrentRole();
  const role = roleQuery.data;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (client: Client) => {
      if (!tenantId) throw new Error("Нет активного тенанта");
      if (role !== "owner" && role !== "dispatcher") {
        throw new Error("Восстановить клиента может владелец или диспетчер.");
      }
      await restoreClientCached(supabase, client, tenantId);
      return { ...client, deleted_at: null, purge_at: null } satisfies Client;
    },
    onSuccess: (restored, client) => {
      void qc.invalidateQueries({ queryKey: ["clients"] });
      void qc.invalidateQueries({ queryKey: ["archived-clients"] });
      void qc.invalidateQueries({ queryKey: ["trashed-clients"] });
      void qc.invalidateQueries({ queryKey: ["client", client.id] });
      if (restored.reminder_at) syncClientReminderWithFeedback(restored);
    },
    meta: { errorHandled: true },
  });
}

/** СТЕРЕТЬ НАВСЕГДА — из корзины, без ожидания срока. Возврата нет.
 *
 *  База не даст стереть клиента, за которым есть заявки, инвойсы или деньги
 *  (триггер guard_client_hard_delete_history): за ним стоит чужая финансовая
 *  история. Такой клиент в корзину и не попадает — интерфейс предлагает ему
 *  только архив, — но сообщение на этот случай честное, а не «ошибка базы». */
export function useDeleteClientForever() {
  const tenantId = useTenantId();
  const roleQuery = useCurrentRole();
  const role = roleQuery.data;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      if (!tenantId) throw new Error("Нет активного тенанта");
      if (role !== "owner") {
        throw new Error("Стереть клиента навсегда может только владелец.");
      }
      try {
        await deleteClientCached(supabase, id, tenantId);
      } catch (e) {
        const text = (e as Error).message ?? "";
        if (/history|истори/i.test(text)) {
          throw new Error(
            "У клиента есть заявки или деньги — стереть его нельзя. Такой клиент живёт в архиве.",
          );
        }
        throw e;
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["clients"] });
      void qc.invalidateQueries({ queryKey: ["trashed-clients"] });
      void qc.invalidateQueries({ queryKey: ["archived-clients"] });
    },
    meta: { errorHandled: true },
  });
}

export function useClientTags() {
  const tenantId = useTenantId();
  const roleQuery = useCurrentRole();
  const role = roleQuery.data;
  return useQuery({
    queryKey: clientTagsQueryKey(tenantId, role),
    enabled: !!tenantId && roleQuery.isSuccess && role != null,
    // SWR wrapper read (same as useClients): warm cache serves instantly, the
    // background revalidate prunes + emits, the realtime bridge re-reads.
    queryFn: () =>
      role === "master"
        ? Promise.resolve([])
        : listClientTagsCached(supabase, tenantId as string),
  });
}

export interface CreateClientTagInput {
  name: string;
  color: string;
}

export interface UpdateClientTagInput {
  id: string;
  patch: {
    name?: string;
    color?: string;
  };
}

function assertCanManageClientTags(
  tenantId: string | null,
  role: UserRole | null | undefined,
): asserts tenantId is string {
  if (!tenantId) throw new Error("Нет активного тенанта");
  if (role !== "owner" && role !== "dispatcher") {
    throw new Error("Управлять тегами может владелец или диспетчер.");
  }
}

function invalidateClientTags(qc: ReturnType<typeof useQueryClient>) {
  // A deleted tag is removed from client_tag_assignments on the server. The
  // client list/cache also needs a refresh so no stale tag id survives in an
  // already-open card or CSV export.
  void qc.invalidateQueries({ queryKey: ["client-tags"] });
  void qc.invalidateQueries({ queryKey: ["clients"] });
  void qc.invalidateQueries({ queryKey: ["client"] });
}

export function useCreateClientTag() {
  const tenantId = useTenantId();
  const role = useCurrentRole().data;
  const qc = useQueryClient();
  return useMutation<ClientTag, Error, CreateClientTagInput>({
    mutationFn: ({ name, color }) => {
      assertCanManageClientTags(tenantId, role);
      const normalizedName = name.trim();
      if (!normalizedName) throw new Error("Введите название тега.");
      return createClientTagCached(
        supabase,
        { name: normalizedName, color },
        tenantId,
      );
    },
    onSettled: () => invalidateClientTags(qc),
    meta: { errorHandled: true },
  });
}

export function useUpdateClientTag() {
  const tenantId = useTenantId();
  const role = useCurrentRole().data;
  const qc = useQueryClient();
  return useMutation<ClientTag, Error, UpdateClientTagInput>({
    mutationFn: ({ id, patch }) => {
      assertCanManageClientTags(tenantId, role);
      const normalizedPatch = {
        ...patch,
        ...(patch.name != null ? { name: patch.name.trim() } : null),
      };
      if (normalizedPatch.name === "") {
        throw new Error("Введите название тега.");
      }
      return updateClientTagCached(supabase, id, normalizedPatch, tenantId);
    },
    onSettled: () => invalidateClientTags(qc),
    meta: { errorHandled: true },
  });
}

export function useDeleteClientTag() {
  const tenantId = useTenantId();
  const role = useCurrentRole().data;
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => {
      assertCanManageClientTags(tenantId, role);
      return deleteClientTagCached(supabase, id, tenantId);
    },
    onSettled: () => invalidateClientTags(qc),
    meta: { errorHandled: true },
  });
}
