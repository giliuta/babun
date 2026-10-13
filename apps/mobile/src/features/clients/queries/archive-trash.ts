import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  clientWriteRefusal,
  purgeDateFromNow,
} from "@babun/shared/db/repositories/clients";
import {
  listArchivedClients as listArchivedCached,
  listTrashedClients as listTrashedCached,
  archiveClient as archiveClientCached,
  restoreClient as restoreClientCached,
  deleteClient as deleteClientCached,
} from "@babun/shared/sync/clientsCached";
import type { Client } from "@babun/shared/local/clients";
import { supabase } from "@/lib/supabase";
import { tenantBoundClient } from "@/lib/tenant-bound-client";
import { cancelClientReminder } from "@/features/clients/reminders";
import { NEVER_PAUSE } from "@/features/finances/accounts";
import { clientKeys } from "../query-keys";
import type { ClientWriteTarget } from "./mutations-update";
import { syncClientReminderWithFeedback } from "./reminder-feedback";
import { assertOwnCompany, useQueryScope, writeClientOf } from "./scope";

/** ПАРТНЁР С «УДАЛЕНИЕ КЛИЕНТА: МОЖЕТ» УДАЛЯЕТ КЛИЕНТА (владелец 03.10).
 *  Своей дверью `member_trash_client`: клиент уходит в «Удалённые клиенты»;
 *  без истории он сотрётся через 30 дней, с историей — лежит там, пока
 *  владелец его не вернёт. */
export function useTrashClientAsPartner() {
  const scope = useQueryScope();
  const qc = useQueryClient();
  return useMutation({
    // Без сети удаление не ждёт молча, чтобы сработать потом, когда его уже
    // не ждут: отказ сразу, словами «Нет связи с сервером» (03.10).
    networkMode: "always",
    mutationFn: async (target: string | ClientWriteTarget) => {
      const { id, source } = typeof target === "string" ? { id: target, source: undefined } : target;
      // Строка работодателя — клиентом, привязанным к ЕГО компании: дверь
      // берёт компанию из заголовка.
      const db = source ? tenantBoundClient(source.tenantId) : writeClientOf(scope);
      const { error } = await db.rpc("member_trash_client", { p_client_id: id });
      // Отказ — словами (`block:clients.delete` → «Нет права удалять
      // клиентов»), а не английским текстом сервера.
      if (error) throw new Error(clientWriteRefusal(error) ?? error.message);
    },
    onSuccess: (_d, target) => {
      const id = typeof target === "string" ? target : target.id;
      qc.setQueriesData<Client[]>({ queryKey: clientKeys.all() }, (list) =>
        Array.isArray(list) ? list.filter((c) => c.id !== id) : list,
      );
      // «Напомнить» об удалённом клиенте снимается и у партнёра, как у
      // владельца (повторный аудит 03.10): иначе пуш приходил в срок и вёл на
      // удалённую карточку.
      void cancelClientReminder(id);
      void qc.invalidateQueries({ queryKey: clientKeys.all() });
      void qc.invalidateQueries({ queryKey: clientKeys.card(id) });
    },
    meta: { errorHandled: true }, // caller messages the refusal itself
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

/** `trash: true` — клиент уходит в «Удалённые клиенты» со сроком 30 дней;
 *  иначе без срока (дубль после слияния). Клиенту с историей база срок
 *  снимает сама (`client_history_never_purges`, 03.10): архива как полки у
 *  клиентов больше нет — экран один. */
export interface ArchiveClientsInput {
  ids: string[];
  trash?: boolean;
}

export function useArchiveClients() {
  const scope = useQueryScope();
  const qc = useQueryClient();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: async (
      input: ArchiveClientsInput,
    ): Promise<ArchiveClientsResult> => {
      const { ids, trash } = input;
      assertOwnCompany(scope, "Убирать клиентов из работы");
      const tenantId = scope.tenantId;
      if (scope.role !== "owner" && scope.role !== "dispatcher") {
        throw new Error("Удалять клиентов может владелец или диспетчер.");
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
          chunk.map((id) =>
            archiveClientCached(writeClientOf(scope), id, tenantId, purgeAt, scope.writeOpts),
          ),
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
    // СТРОКА УХОДИТ СРАЗУ (аудит 29.09: «тост „Клиент в удалённых“ уже
    // показан, а клиент ещё ~5 с в списке и счётчик „11 клиентов“»). Список
    // ждал перечитки с сервера. Теперь убранные исчезают из списка до ответа;
    // отказ возвращает список как был, а частичную неудачу исправит
    // перечитка в `onSettled` — не дошедшие до архива вернутся сами.
    onMutate: async ({ ids }) => {
      await qc.cancelQueries({ queryKey: clientKeys.all() });
      const previous = qc.getQueriesData<Client[]>({ queryKey: clientKeys.all() });
      const gone = new Set(ids);
      qc.setQueriesData<Client[]>({ queryKey: clientKeys.all() }, (list) =>
        Array.isArray(list) ? list.filter((c) => !gone.has(c.id)) : list,
      );
      return { previous };
    },
    onError: (_e, _input, context) => {
      for (const [key, value] of context?.previous ?? []) qc.setQueryData(key, value);
    },
    onSuccess: ({ archivedIds }) => {
      void Promise.all(archivedIds.map(cancelClientReminder));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: clientKeys.all() });
      void qc.invalidateQueries({ queryKey: clientKeys.trashedAll() });
    },
    meta: { errorHandled: true }, // caller messages the partial result itself
  });
}

/** Удалённые ЧИТАЮТСЯ ИЗ КЭША (как рабочий список), а не напрямую с
 *  сервера. Прямое чтение было дырой: архивация, ушедшая в очередь, делала
 *  клиента невидимым везде — из списка его убрали, а сервер ещё считал
 *  живым, и экран архива о нём не знал. */
function useHiddenClients(
  keyOf: typeof clientKeys.trashed,
  read: (client: typeof supabase, tenantId: string) => Promise<Client[]>,
) {
  const scope = useQueryScope();
  const tenantId = scope.tenantId;
  return useQuery({
    queryKey: keyOf(tenantId, scope.view),
    // Архив и корзина — полки СВОЕЙ базы: у работодателя человек гость.
    enabled:
      !!tenantId &&
      scope.ready &&
      scope.kind === "own" &&
      (scope.role === "owner" || scope.role === "dispatcher"),
    // Привязанным клиентом — разбор над `useClients`.
    queryFn: () => read(tenantBoundClient(tenantId as string), tenantId as string),
  });
}

/** «Удалённые клиенты» — ОДНА ПОЛКА (владелец 03.10: архива нет): и те, кто
 *  сотрётся по сроку, и клиенты с историей без срока; свежие удаления —
 *  сверху. */
export function useTrashedClients() {
  return useHiddenClients(clientKeys.trashed, async (client, tenantId) => {
    const [dated, kept] = await Promise.all([
      listTrashedCached(client, tenantId),
      listArchivedCached(client, tenantId),
    ]);
    return [...dated, ...kept].sort((a, b) =>
      (b.deleted_at ?? "").localeCompare(a.deleted_at ?? ""),
    );
  });
}

export function useRestoreClient() {
  const scope = useQueryScope();
  const qc = useQueryClient();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: async (client: Client) => {
      assertOwnCompany(scope, "Возвращать клиентов в работу");
      if (scope.role !== "owner" && scope.role !== "dispatcher") {
        throw new Error("Восстановить клиента может владелец или диспетчер.");
      }
      await restoreClientCached(writeClientOf(scope), client, scope.tenantId, scope.writeOpts);
      return { ...client, deleted_at: null, purge_at: null } satisfies Client;
    },
    onSuccess: (restored, client) => {
      void qc.invalidateQueries({ queryKey: clientKeys.all() });
      void qc.invalidateQueries({ queryKey: clientKeys.trashedAll() });
      void qc.invalidateQueries({ queryKey: clientKeys.card(client.id) });
      if (restored.reminder_at) syncClientReminderWithFeedback(restored);
    },
    // Отказ — тоже повод перечитать: список «Удалённых» показывает правду
    // сервера, а не оптимистичный шаг (аудит 03.10).
    onError: (_error, client) => {
      void qc.invalidateQueries({ queryKey: clientKeys.trashedAll() });
      void qc.invalidateQueries({ queryKey: clientKeys.card(client.id) });
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
  const scope = useQueryScope();
  const qc = useQueryClient();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: async (id: string) => {
      assertOwnCompany(scope, "Стирать клиентов");
      if (scope.role !== "owner") {
        throw new Error("Стереть клиента навсегда может только владелец.");
      }
      try {
        await deleteClientCached(writeClientOf(scope), id, scope.tenantId, scope.writeOpts);
      } catch (e) {
        const text = (e as Error).message ?? "";
        if (/history|истори/i.test(text)) {
          throw new Error(
            "У клиента есть записи или деньги — стереть его нельзя: история остаётся в отчётах.",
          );
        }
        throw e;
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: clientKeys.all() });
      void qc.invalidateQueries({ queryKey: clientKeys.trashedAll() });
    },
    meta: { errorHandled: true },
  });
}
