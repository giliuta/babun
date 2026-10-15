import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateClient as repoUpdateClient } from "@babun/shared/db/repositories/clients";
import { updateClient } from "@babun/shared/sync/clientsCached";
import type { Client } from "@babun/shared/local/clients";
import { isOnline } from "@babun/shared/sync";
import { OnlineOnlyWriteError } from "@babun/shared/sync/cache-errors";
import { tenantBoundClient } from "@/lib/tenant-bound-client";
import { notify } from "@/lib/notify";
import { isPhoneTakenError } from "@/features/clients/client-create-errors";
import { refreshRevealedContacts } from "@/session/revealed-contacts";
import { NEVER_PAUSE } from "@/features/finances/accounts";
import { offlineForeignWriteMessage, type ClientsScope } from "@/session/clients-company";
import { clientKeys } from "@/lib/client-query-keys";
import { syncClientReminderWithFeedback } from "./reminder-feedback";
import { scopeOf, useQueryScope, writeClientOf, type QueryScope } from "./scope";

/** ПРАВКА КЛИЕНТА ИСТОЧНИКА. Своя компания идёт через кэш и очередь (а когда
 *  в календаре открыта другая — отказывает без сети, чтобы операция не уехала
 *  под чужим заголовком). Компания-работодатель пишется прямо на сервер её
 *  клиентом: чужая база на диск не ложится и в очередь не встаёт. */
async function saveClient(
  scope: QueryScope,
  id: string,
  patch: Partial<Client>,
): Promise<Client> {
  // Guard: never fire the PATCH with tenant_id=undefined (session not
  // resolved yet) — it would silently match nothing / hit RLS.
  const tenantId = scope.tenantId;
  if (!tenantId) throw new Error("Аккаунт ещё не открыт — попробуйте ещё раз");
  if (scope.kind === "record") {
    throw new Error("Карточку этого клиента ведёт владелец компании.");
  }
  if (scope.kind === "member") {
    if (!isOnline()) {
      throw new OnlineOnlyWriteError(offlineForeignWriteMessage(scope.tenantName));
    }
    return repoUpdateClient(tenantBoundClient(tenantId), id, patch, tenantId);
  }
  return updateClient(writeClientOf(scope), id, patch, tenantId, scope.writeOpts);
}

/** Ответ правки у сотрудника разбирается общим маппером
 *  (`atomicWriteResultToClient`) и приходит без `blocks` и причины скрытого
 *  номера. Держим прежние, иначе до перечитки закрытые блоки на миг
 *  открылись бы пустыми, а номер — «разблокировался». */
function keepAccessFields(old: Client | null | undefined, updated: Client): Client {
  if (!old || !updated) return updated;
  return {
    ...updated,
    ...(updated.blocks || !old.blocks ? {} : { blocks: old.blocks }),
    ...(updated.contacts_hidden !== undefined || old.contacts_hidden === undefined
      ? {}
      : { contacts_hidden: old.contacts_hidden }),
  };
}

export function useUpdateClient(id: string) {
  const scope = useQueryScope();
  const qc = useQueryClient();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: (patch: Partial<Client>) => saveClient(scope, id, patch),
    onSuccess: (updated, patch) => {
      qc.setQueriesData<Client | null>({ queryKey: clientKeys.card(id) }, (old) =>
        keepAccessFields(old, updated),
      );
      refreshRevealedContacts(scope.tenantId, id, patch);
      // Blocks fire independent mutations (blur saves), so two PATCHes
      // can resolve out of order and the late response would overwrite
      // the newer field. Refetching settles the cache on the server's
      // authoritative row either way.
      qc.invalidateQueries({ queryKey: clientKeys.card(id) });
      qc.invalidateQueries({ queryKey: clientKeys.all() });
      // ЧЕЛОВЕК ВИДЕН И В ЧУЖОМ БЛОКЕ «ЛЮДИ» — своим запросом
      // (`client-members`). Без этого Марии вписали номер на её карточке, а у
      // Павла в «Людях» она осталась без трубки: владелец 22.09 прочитал это
      // как «номер не сохраняется», хотя в базе он был.
      qc.invalidateQueries({ queryKey: clientKeys.memberAll() });
      if (patch.reminder_at !== undefined) {
        syncClientReminderWithFeedback(updated);
      }
    },
    onError: (e) => {
      // Номер сменили на занятый: арбитр — UNIQUE-индекс базы. Сырой текст
      // Postgres человеку не показываем (владелец 30.09: дубль не заводится).
      if (isPhoneTakenError(e)) {
        notify("Этот номер уже зарегистрирован", "Он у другого клиента — сохранить нельзя.");
        return;
      }
      // The blocks keep edits in local drafts and never read isError —
      // without this a failed save is silently lost until remount.
      notify(
        "Не удалось сохранить",
        (e as Error).message || "Проверьте соединение и попробуйте ещё раз.",
      );
    },
  });
}

/** КЛИЕНТ ЧУЖОЙ СТРОКИ СПИСКА (аудит 03.10). Список склеен из нескольких
 *  компаний, а источник у экрана один — своя. Действие по строке
 *  работодателя (`guestOf`) несёт её источник: без него запись ушла бы под
 *  заголовком своей компании и не нашла бы клиента. Нет `source` — источник
 *  экрана, как было. */
export interface ClientWriteTarget {
  id: string;
  source?: ClientsScope;
}

// Как useUpdateClient, но id приходит с вызовом — для действий по строке
// СПИСКА (long-press меню: закрепить, напомнить), где хук на каждый ряд
// не заведёшь. Семантика кэша и ошибок — та же.
//
// ПРАВКА ВИДНА ДО ОТВЕТА СЕРВЕРА И ОТКАТЫВАЕТСЯ ПРИ ОТКАЗЕ (STORY-086).
// Этим хуком пишутся связи людей: связь правится в строке ЧУЖОЙ карточки
// (добавили Екатерину к Павлу — патчится Екатерина), и её собственная строка
// в кэше обязана измениться сразу — иначе следующая правка соберёт патч от
// старого массива и затрёт первую. `notify` в `onError` при этом остаётся:
// откат чинит кэш, но молчать об отказе нельзя.
export function useUpdateClientById() {
  const scope = useQueryScope();
  const qc = useQueryClient();
  return useMutation({
    ...NEVER_PAUSE,
    // `source` — строка работодателя из общего списка (`ClientWriteTarget`):
    // правка идёт его компании, а не источнику экрана.
    mutationFn: ({ id, patch, source }: ClientWriteTarget & { patch: Partial<Client> }) =>
      saveClient(source ? scopeOf(source) : scope, id, patch),
    onMutate: async ({ id, patch }) => {
      // Чтение, уже летящее по этому ключу, ответит ПОСЛЕ нашей подстановки и
      // вернуло бы строку без правки — отменяем его до, а не после.
      await qc.cancelQueries({ queryKey: clientKeys.card(id) });
      const previous = qc.getQueriesData<Client | null>({ queryKey: clientKeys.card(id) });
      qc.setQueriesData<Client | null>({ queryKey: clientKeys.card(id) }, (current) =>
        current ? { ...current, ...patch } : current,
      );
      return { previous };
    },
    onSuccess: (updated, { id, patch, source }) => {
      qc.setQueriesData<Client | null>({ queryKey: clientKeys.card(id) }, (old) =>
        keepAccessFields(old, updated),
      );
      refreshRevealedContacts(source?.tenantId ?? scope.tenantId, id, patch);
      qc.invalidateQueries({ queryKey: clientKeys.card(id) });
      qc.invalidateQueries({ queryKey: clientKeys.all() });
      // ЧЕЛОВЕК ВИДЕН И В ЧУЖОМ БЛОКЕ «ЛЮДИ» — своим запросом
      // (`client-members`). Без этого Марии вписали номер на её карточке, а у
      // Павла в «Людях» она осталась без трубки: владелец 22.09 прочитал это
      // как «номер не сохраняется», хотя в базе он был.
      qc.invalidateQueries({ queryKey: clientKeys.memberAll() });
      if (patch.reminder_at !== undefined) {
        syncClientReminderWithFeedback(updated);
      }
    },
    onError: (e, variables, context) => {
      // Откатываем ТОЛЬКО поля своей правки (аудит 23.09). Прежде в кэш
      // возвращалась вся строка, снятая до записи, — и неудачная связь заодно
      // откатывала объект или набор реквизитов, добавленный в это же время
      // удачной записью с карточки; следующая запись уносила откат в базу.
      const keys = Object.keys(variables.patch) as (keyof Client)[];
      for (const [key, value] of context?.previous ?? []) {
        qc.setQueryData<Client | null>(key, (current) => {
          if (!current || !value) return value;
          const restored: Partial<Client> = {};
          for (const k of keys) (restored as Record<string, unknown>)[k] = value[k];
          return { ...current, ...restored };
        });
      }
      notify(
        "Не удалось сохранить",
        (e as Error).message || "Проверьте соединение и попробуйте ещё раз.",
      );
    },
  });
}
