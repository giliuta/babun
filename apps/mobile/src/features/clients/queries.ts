import { useMemo } from "react";
import { Linking } from "react-native";
import { useMirror } from "@/features/access/mirror/mirror-state";
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
  createClient as repoCreateClient,
  updateClient as repoUpdateClient,
  listClientTags as repoListClientTags,
  rowToClient,
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
import { OnlineOnlyWriteError } from "@babun/shared/sync/cache-errors";
import { supabase } from "@/lib/supabase";
import { tenantBoundClient } from "@/lib/tenant-bound-client";
import { confirmThen } from "@/lib/confirm";
import { notify } from "@/lib/notify";
import { preflightQuotaForCreate } from "@/lib/quota";
import { useTenantId } from "@/lib/tenant";
import {
  clientsQueryKey,
  clientTagsQueryKey,
  sourceClientQueryKey,
  sourceClientTagsQueryKey,
  sourceClientsQueryKey,
} from "@/lib/company-query-keys";
import { useCurrentRole, type UserRole } from "@/features/settings/tenant";
import { useClientsScopeOrNull } from "./company-scope";
import {
  activeCompanyScope,
  capabilitiesOf,
  offlineForeignWriteMessage,
  viewKeyOf,
  type ClientsCompanyKind,
  type ClientsScope,
} from "./clients-company";
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
    confirmThen(
      "Дата сохранена",
      {
        message: "Уведомление не запланировано, потому что оно выключено для Babun в настройках iPhone.",
        confirmLabel: "Открыть настройки",
      },
      () => void Linking.openSettings(),
    );
    return;
  }
  if (result === "deferred") {
    notify(
      "Дата сохранена",
      "Напоминание сохранено в очереди и установится, когда на iPhone освободится место.",
    );
    return;
  }
  if (result === "capacity") {
    notify(
      "Дата сохранена",
      "Очередь напоминаний переполнена. Удалите ненужные напоминания и сохраните дату ещё раз.",
    );
    return;
  }
  notify(
    "Дата сохранена",
    result === "past"
      ? "Эта дата уже прошла, поэтому системное уведомление не создавалось."
      : "Системное уведомление не удалось создать. Обновите приложение и повторите попытку.",
  );
}

function syncClientReminderWithFeedback(client: Client): void {
  void syncClientReminder(client).then(surfaceClientReminderResult);
}

/** Ключи живут в `lib/company-query-keys.ts`; реэкспорт для тех, кто уже
 *  импортирует их отсюда (`label-auto-assign`). */
export { clientsQueryKey, clientTagsQueryKey };

// ИСТОЧНИК ЭКРАНА: СВОЯ КОМПАНИЯ, КОМПАНИЯ-РАБОТОДАТЕЛЬ ИЛИ КЛИЕНТ ЗАПИСИ.
//
// Вкладка «Клиенты» стала общей страницей (STORY-082): список склеен из своей
// компании и тех, где человеку открыли клиентов, а карточка живёт в компании
// своей строки. Источник объявляет экран (`company-scope.tsx`), хуки его
// читают. ВНЕ ВКЛАДКИ ПРОВАЙДЕРА НЕТ — и всё работает как раньше, по активной
// компании и роли: так зовут эти хуки форма записи, пикеры и «Финансы дня».
interface QueryScope {
  tenantId: string | null;
  role: UserRole | null | undefined;
  kind: ClientsCompanyKind;
  /** Третий элемент ключей: роль у своей компании, уровни у работодателя. */
  view: string;
  ready: boolean;
  isActive: boolean;
  /** Видны ли телефоны и мессенджеры (уровень «Телефоны и контакты»). */
  contacts: boolean;
  tenantName: string | null;
  /** Правку нельзя отложить в очередь — текст отказа без сети. */
  writeOpts: { onlineOnly: string } | undefined;
}

function useQueryScope(): QueryScope {
  const scope = useClientsScopeOrNull();
  const activeTenantId = useTenantId();
  const roleQuery = useCurrentRole();
  const activeRole = roleQuery.data;
  if (scope) return scopeOf(scope);
  return {
    tenantId: activeTenantId,
    role: activeRole,
    // Мастер вне вкладки читает клиентов своих записей безопасной функцией —
    // ровно как до общей страницы.
    kind: activeRole === "master" ? "record" : "own",
    view: activeRole ?? "role-pending",
    ready: roleQuery.isSuccess && activeRole != null,
    isActive: true,
    contacts: true,
    tenantName: null,
    writeOpts: undefined,
  };
}

/** ИСТОЧНИК ЭКРАНА ЦЕЛИКОМ — для правил, которым мало `QueryScope`.
 *
 *  `QueryScope` несёт СЛЕПОК уровней одной строкой (`view`) — ключу запроса
 *  этого хватает, а правилу нет: `caps.links` считается из «Какие клиенты» и
 *  «Телефоны», и разбирать их обратно из строки значило бы завести второе
 *  правило. Вне вкладки источник тот же, что у `useQueryScope`: компания
 *  устройства и роль в ней. `null` — роль ещё в пути. */
export function useClientsSourceScope(): ClientsScope | null {
  const scope = useClientsScopeOrNull();
  const activeTenantId = useTenantId();
  const activeRole = useCurrentRole().data;
  return useMemo(() => {
    if (scope) return scope;
    if (!activeTenantId || !activeRole) return null;
    return activeCompanyScope(activeTenantId, activeRole, null);
  }, [scope, activeTenantId, activeRole]);
}

function scopeOf(scope: ClientsScope): QueryScope {
  return {
    tenantId: scope.tenantId,
    role: scope.role,
    kind: scope.kind,
    view: viewKeyOf(scope),
    ready: true,
    isActive: scope.isActive,
    contacts: scope.contacts,
    tenantName: scope.tenantName,
    writeOpts: capabilitiesOf(scope).onlineOnly
      ? { onlineOnly: offlineForeignWriteMessage(scope.tenantName) }
      : undefined,
  };
}

/** Хозяйство базы — архив, корзина, справочник тегов, импорт — живёт только у
 *  СВОЕЙ компании: у работодателя человек гость, даже когда «Меняет». */
function assertOwnCompany(scope: QueryScope, what: string): asserts scope is QueryScope & { tenantId: string } {
  if (!scope.tenantId) throw new Error("Нет активного тенанта");
  if (scope.kind !== "own") {
    throw new Error(`${what} можно только в своей компании.`);
  }
}

/** Клиент Supabase источника: активная компания — обычный, остальные —
 *  привязанный заголовком к своей компании. */
function writeClientOf(scope: QueryScope) {
  return scope.isActive ? supabase : tenantBoundClient(scope.tenantId as string);
}

/** Клиент — параметром: прогрев чужой компании зовёт ту же функцию клиентом,
 *  привязанным к ней (`bind-tenant.ts`). */
export async function listMasterClientsSafe(
  client: typeof supabase,
  clientId?: string,
): Promise<Client[]> {
  const { data, error } = await client.rpc("list_master_clients_safe", {
    ...(clientId ? { p_client_id: clientId } : {}),
  });
  if (error) throw new Error(`listMasterClientsSafe: ${error.message}`);
  return (data ?? []).map(masterClientJsonToClient);
}

/** Сгенерированный `database.types.ts` отстаёт от базы и окна ещё не знает.
 *  Узкий тип вместо `any`: канон запрещает `any`, а делать вид, что функции
 *  нет, нельзя. Уйдёт, когда типы перегенерируют. */
type RpcWithMemberClients = {
  rpc: (
    name: "list_member_clients",
    args?: { p_client_id?: string },
  ) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
};

/** Ответ окна — строка клиента в JSON плюс `tag_ids`: разбирается тем же
 *  маппером, что прямое чтение, значит на экране тот же домен. Его же зовёт
 *  чтение людей карточки (`use-client-links.ts`): `list_client_members` —
 *  такое же окно, и второй разборщик разошёлся бы с этим на первом же поле. */
export function memberClientJsonToClient(row: unknown): Client {
  const record = row as Parameters<typeof rowToClient>[0] & { tag_ids?: unknown };
  return {
    ...rowToClient(record),
    tag_ids: Array.isArray(record.tag_ids)
      ? record.tag_ids.filter((id): id is string => typeof id === "string")
      : [],
  };
}

/** КЛИЕНТЫ КОМПАНИИ-РАБОТОДАТЕЛЯ — ТОЛЬКО ОКНОМ СЕРВЕРА.
 *
 *  Таблица сотруднику закрыта: её строка несёт телефоны и деньги клиента, а
 *  колонку правилом не спрячешь. Окно `list_member_clients` отдаёт ровно то,
 *  что ему открыли уровнями «Клиенты», «Какие клиенты» и «Телефоны». SQLite
 *  здесь не при чём: чужая база на диск не ложится и в очередь не встаёт. */
export async function listMemberClients(
  client: typeof supabase,
  clientId?: string,
): Promise<Client[]> {
  const rpc = client as unknown as RpcWithMemberClients;
  const { data, error } = await rpc.rpc(
    "list_member_clients",
    clientId ? { p_client_id: clientId } : undefined,
  );
  if (error) throw new Error(`listMemberClients: ${error.message}`);
  return (data ?? []).map(memberClientJsonToClient);
}

// Clients list — SWR wrapper read (full domain shape incl. tag_ids, served
// from the SQLite cache when warm, then revalidated). RLS scopes rows to the
// tenant; we pass tenantId for the query key and the RLS/cache filter.
//
// ЧТЕНИЯ ЧЕРЕЗ SQLite-ОБЁРТКИ — КЛИЕНТОМ, ПРИВЯЗАННЫМ К КОМПАНИИ КЛЮЧА. Обёртка
// отдаёт снимок и отпускает фоновое перечитывание: страницы клиентов, потом
// отдельный запрос `updated_at`. Глобальный клиент берёт заголовок на каждый
// запрос, и переход посреди этой цепочки отправлял бы её хвост под другой
// компанией: ноль строк, `cacheReplaceTenant` стирает клиентов этой компании,
// а уцелевшие ложатся без штампа LWW. Мастерские RPC идут прежним клиентом:
// SQLite они не пишут.
//
// ЦЕНА, ПРИНЯТАЯ НАМЕРЕННО. Привязанный клиент объявляет себя полем
// `BOUND_TENANT_FIELD`, и выгрузка очереди через него не работает вовсе. Когда
// перечитывание пропущено из-за ждущих операций, его `kickReplayer` теперь
// ничего не делает; очередь всё равно разгребают старт синхронизации, возврат
// сети и мутации — они зовут выгрузку глобальным клиентом. Снимать поле
// нельзя: непомеченный привязанный клиент выгрузил бы удаление активной
// компании под заголовком другой.

// ЗЕРКАЛО ГАСИТ КОНТАКТЫ НА КЛИЕНТЕ (STORY-083).
//
// В предпросмотре строки приходят с сервера по токену ВЛАДЕЛЬЦА, а он видит
// всё: сервер не знает, что владелец «смотрит чужими глазами». Значит уровень
// «Телефоны и контакты: Скрыт» в зеркале не сработал бы — и предпросмотр
// соврал бы ровно там, где владелец боится сильнее всего.
//
// Здесь контакты вырезаются теми же полями, что вырезает сервер настоящему
// сотруднику (`client_without_contacts`). Только для показа: запись из зеркала
// невозможна — это чужие глаза, а не чужие руки.
function clientWithoutContacts(row: Client): Client {
  // ПУСТАЯ СТРОКА, А НЕ `null`. Поля контактов объявлены `string` (кроме
  // `phone_e164`), и подстановка `null` в них — ложь типу: экран карточки
  // зовёт `.trim()` на почте и мессенджерах без проверки, и в зеркале это
  // падало бы у владельца на ровном месте. Гасим тем же значением, каким
  // рождается пустой клиент.
  return {
    ...row,
    phone: "",
    phone_e164: null,
    whatsapp_phone: "",
    email: "",
    telegram_username: "",
    instagram_username: "",
    phones: [],
  };
}

function withoutContacts(rows: Client[]): Client[] {
  return rows.map(clientWithoutContacts);
}

/** Тот же покров на ОДНОГО клиента — для карточки. Без него список молчал, а
 *  карточка того же человека показывала телефон, почту и мессенджеры: экран
 *  открывается тем же зеркалом, а `select` у него был свой. */
function maybeWithoutContacts(client: Client | null | undefined): Client | null {
  if (!client) return client ?? null;
  return clientWithoutContacts(client);
}

export function useClients() {
  const scope = useQueryScope();
  const tenantId = scope.tenantId;
  // В зеркале контакты гасит экран: сервер отдал их владельцу.
  const hideContacts = useMirror() !== null && scope.kind === "member" && !scope.contacts;
  return useQuery({
    // У своей компании и у клиента записи ключ ТОТ ЖЕ, что был, — его греет
    // прогрев компании (`tenant-prefetch-plan`). У работодателя третий
    // элемент несёт уровни: сменили уровень — сменился ключ.
    queryKey:
      scope.kind === "member"
        ? sourceClientsQueryKey(tenantId, scope.view)
        : clientsQueryKey(tenantId, scope.role),
    enabled: !!tenantId && scope.ready,
    queryFn: () => {
      if (scope.kind === "record") return listMasterClientsSafe(supabase);
      if (scope.kind === "member") {
        return listMemberClients(tenantBoundClient(tenantId as string));
      }
      return listClientsCached(tenantBoundClient(tenantId as string), tenantId as string);
    },
    select: hideContacts ? withoutContacts : undefined,
  });
}

export function useClient(id: string) {
  const scope = useQueryScope();
  const tenantId = scope.tenantId;
  const qc = useQueryClient();
  // Тот же уровень, что и у списка: карточка — это тот же клиент, открытый
  // крупнее, и прятать контакты только в списке значит не прятать их вовсе.
  const hideContacts = useMirror() !== null && scope.kind === "member" && !scope.contacts;
  return useQuery({
    queryKey: sourceClientQueryKey(id, tenantId, scope.view),
    enabled: !!tenantId && !!id && scope.ready,
    placeholderData: () => {
      const list = qc.getQueryData<Client[]>(
        scope.kind === "member"
          ? sourceClientsQueryKey(tenantId, scope.view)
          : clientsQueryKey(tenantId, scope.role),
      );
      const found = list?.find((client) => client.id === id);
      // Подстановка берёт строку из КЭША списка, а покров списка живёт в
      // `select` и кэш не меняет: без этого карточка мигала бы настоящим
      // телефоном до ответа сервера.
      return hideContacts ? (maybeWithoutContacts(found) ?? undefined) : found;
    },
    queryFn: async () => {
      if (scope.kind === "record") {
        return (await listMasterClientsSafe(supabase, id))[0] ?? null;
      }
      if (scope.kind === "member") {
        return (await listMemberClients(tenantBoundClient(tenantId as string), id))[0] ?? null;
      }
      try {
        return await getClient(tenantBoundClient(tenantId as string), id, tenantId as string);
      } catch (error) {
        const serverError =
          error && typeof error === "object"
            ? (error as { code?: string; message?: string })
            : { message: String(error) };
        if (!isConfirmedNetworkUnavailable(serverError)) throw error;
        // The list is offline-aware and may already have the complete domain
        // client in SQLite. A connection loss after opening the list should
        // therefore keep the card usable instead of becoming «not found».
        // Привязанным клиентом — разбор над `useClients`.
        const cached = await listClientsCached(
          tenantBoundClient(tenantId as string),
          tenantId as string,
        );
        const client = cached.find((item) => item.id === id);
        if (client) return client;
        throw error;
      }
    },
    select: hideContacts ? maybeWithoutContacts : undefined,
  });
}

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
  if (!tenantId) throw new Error("Нет активного тенанта");
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

export function useUpdateClient(id: string) {
  const scope = useQueryScope();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Client>) => saveClient(scope, id, patch),
    onSuccess: (updated, patch) => {
      qc.setQueriesData({ queryKey: ["client", id] }, updated);
      // Blocks fire independent mutations (blur saves), so two PATCHes
      // can resolve out of order and the late response would overwrite
      // the newer field. Refetching settles the cache on the server's
      // authoritative row either way.
      qc.invalidateQueries({ queryKey: ["client", id] });
      qc.invalidateQueries({ queryKey: ["clients"] });
      // ЧЕЛОВЕК ВИДЕН И В ЧУЖОМ БЛОКЕ «ЛЮДИ» — своим запросом
      // (`client-members`). Без этого Марии вписали номер на её карточке, а у
      // Павла в «Людях» она осталась без трубки: владелец 22.09 прочитал это
      // как «номер не сохраняется», хотя в базе он был.
      qc.invalidateQueries({ queryKey: ["client-members"] });
      if (patch.reminder_at !== undefined) {
        syncClientReminderWithFeedback(updated);
      }
    },
    onError: (e) => {
      // The blocks keep edits in local drafts and never read isError —
      // without this a failed save is silently lost until remount.
      notify(
        "Не удалось сохранить",
        (e as Error).message || "Проверьте соединение и попробуйте ещё раз.",
      );
    },
  });
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
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Client> }) =>
      saveClient(scope, id, patch),
    onMutate: async ({ id, patch }) => {
      // Чтение, уже летящее по этому ключу, ответит ПОСЛЕ нашей подстановки и
      // вернуло бы строку без правки — отменяем его до, а не после.
      await qc.cancelQueries({ queryKey: ["client", id] });
      const previous = qc.getQueriesData<Client | null>({ queryKey: ["client", id] });
      qc.setQueriesData<Client | null>({ queryKey: ["client", id] }, (current) =>
        current ? { ...current, ...patch } : current,
      );
      return { previous };
    },
    onSuccess: (updated, { id, patch }) => {
      qc.setQueriesData({ queryKey: ["client", id] }, updated);
      qc.invalidateQueries({ queryKey: ["client", id] });
      qc.invalidateQueries({ queryKey: ["clients"] });
      // ЧЕЛОВЕК ВИДЕН И В ЧУЖОМ БЛОКЕ «ЛЮДИ» — своим запросом
      // (`client-members`). Без этого Марии вписали номер на её карточке, а у
      // Павла в «Людях» она осталась без трубки: владелец 22.09 прочитал это
      // как «номер не сохраняется», хотя в базе он был.
      qc.invalidateQueries({ queryKey: ["client-members"] });
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

export function useCreateClient() {
  const scope = useQueryScope();
  const tenantId = scope.tenantId;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (overrides: Partial<Client>) => {
      if (!tenantId) throw new Error("Нет активного тенанта");
      if (scope.kind === "record") {
        throw new Error("Заводить клиентов этой компании может её владелец.");
      }
      if (scope.kind === "member" && !isOnline()) {
        throw new OnlineOnlyWriteError(offlineForeignWriteMessage(scope.tenantName));
      }
      await preflightQuotaForCreate(writeClientOf(scope), tenantId, "clients", {
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
      const fresh = { ...blank, id: randomUuid() };
      // Клиент работодателя заводится прямо на сервере его компании: очередь и
      // копия на диске — хозяйство своей базы.
      if (scope.kind === "member") {
        return repoCreateClient(tenantBoundClient(tenantId), fresh, tenantId);
      }
      return createClientCached(
        writeClientOf(scope),
        fresh,
        tenantId,
        scope.writeOpts,
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
  const scope = useQueryScope();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: ArchiveClientsInput,
    ): Promise<ArchiveClientsResult> => {
      const { ids, trash } = input;
      assertOwnCompany(scope, "Убирать клиентов из работы");
      const tenantId = scope.tenantId;
      if (scope.role !== "owner" && scope.role !== "dispatcher") {
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
  const scope = useQueryScope();
  const tenantId = scope.tenantId;
  return useQuery({
    queryKey: [key, tenantId, scope.view],
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

/** Архив: убраны из работы бессрочно. */
export function useArchivedClients() {
  return useHiddenClients("archived-clients", listArchivedCached);
}

/** «Недавно удалённые»: сотрутся по своему сроку. */
export function useTrashedClients() {
  return useHiddenClients("trashed-clients", listTrashedCached);
}

export function useRestoreClient() {
  const scope = useQueryScope();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (client: Client) => {
      assertOwnCompany(scope, "Возвращать клиентов в работу");
      if (scope.role !== "owner" && scope.role !== "dispatcher") {
        throw new Error("Восстановить клиента может владелец или диспетчер.");
      }
      await restoreClientCached(writeClientOf(scope), client, scope.tenantId, scope.writeOpts);
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
  const scope = useQueryScope();
  const qc = useQueryClient();
  return useMutation({
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
  const scope = useQueryScope();
  const tenantId = scope.tenantId;
  return useQuery({
    queryKey:
      scope.kind === "member"
        ? sourceClientTagsQueryKey(tenantId, scope.view)
        : clientTagsQueryKey(tenantId, scope.role),
    enabled: !!tenantId && scope.ready,
    // SWR wrapper read (same as useClients): warm cache serves instantly, the
    // background revalidate prunes + emits, the realtime bridge re-reads.
    // Привязанным клиентом — разбор над `useClients`.
    queryFn: () => {
      // Клиент записи метками компании не распоряжается и не видит их.
      if (scope.kind === "record") return Promise.resolve([]);
      // Метки работодателя нужны, чтобы его клиенты в списке были подписаны,
      // но на диск чужой справочник не ложится — читаем напрямую.
      if (scope.kind === "member") {
        return repoListClientTags(tenantBoundClient(tenantId as string), tenantId as string);
      }
      return listClientTagsCached(tenantBoundClient(tenantId as string), tenantId as string);
    },
  });
}

export interface CreateClientTagInput {
  name: string;
  color: string;
  icon?: string | null;
}

export interface UpdateClientTagInput {
  id: string;
  patch: {
    name?: string;
    color?: string;
    icon?: string | null;
    position?: number;
    hidden?: boolean;
  };
}

/** Справочник тегов — хозяйство своей компании: у работодателя человек метки
 *  видит (они стоят на его клиентах), но не правит. */
function assertCanManageClientTags(
  scope: QueryScope,
): asserts scope is QueryScope & { tenantId: string } {
  assertOwnCompany(scope, "Управлять тегами");
  if (scope.role !== "owner" && scope.role !== "dispatcher") {
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
  const scope = useQueryScope();
  const qc = useQueryClient();
  return useMutation<ClientTag, Error, CreateClientTagInput>({
    mutationFn: ({ name, color, icon }) => {
      assertCanManageClientTags(scope);
      const normalizedName = name.trim();
      if (!normalizedName) throw new Error("Введите название тега.");
      return createClientTagCached(
        writeClientOf(scope),
        { name: normalizedName, color, icon: icon ?? null },
        scope.tenantId,
        scope.writeOpts,
      );
    },
    onSettled: () => invalidateClientTags(qc),
    meta: { errorHandled: true },
  });
}

export function useUpdateClientTag() {
  const scope = useQueryScope();
  const qc = useQueryClient();
  return useMutation<ClientTag, Error, UpdateClientTagInput>({
    mutationFn: ({ id, patch }) => {
      assertCanManageClientTags(scope);
      const normalizedPatch = {
        ...patch,
        ...(patch.name != null ? { name: patch.name.trim() } : null),
      };
      if (normalizedPatch.name === "") {
        throw new Error("Введите название тега.");
      }
      return updateClientTagCached(writeClientOf(scope), id, normalizedPatch, scope.tenantId, scope.writeOpts);
    },
    onSettled: () => invalidateClientTags(qc),
    meta: { errorHandled: true },
  });
}

/** СКРЫТЬ И ПОКАЗАТЬ — левая кромка свайпа, как у категории и метки (владелец
 *  2026-09-10: «свайп вправо — с левой стороны появляется „Скрыть“… везде во
 *  всех одно и то же»). Скрытый тег остаётся у клиентов, которым уже
 *  проставлен: скрытие — про справочник, а не про данные. */
export function useSetClientTagHidden() {
  const scope = useQueryScope();
  const qc = useQueryClient();
  return useMutation<ClientTag, Error, { id: string; hidden: boolean }>({
    mutationFn: ({ id, hidden }) => {
      assertCanManageClientTags(scope);
      return updateClientTagCached(writeClientOf(scope), id, { hidden }, scope.tenantId, scope.writeOpts);
    },
    onSettled: () => invalidateClientTags(qc),
    meta: { errorHandled: true },
  });
}

/** ПОРЯДОК СПРАВОЧНИКА — рукой за ручку. Пишем построчно: тегов у бизнеса
 *  единицы, а один upsert потребовал бы отправлять имя и цвет каждой строки,
 *  то есть шанс затереть чужую правку, пришедшую между чтением и записью. */
export function useReorderClientTags() {
  const scope = useQueryScope();
  const qc = useQueryClient();
  return useMutation<void, Error, string[]>({
    mutationFn: async (orderedIds) => {
      assertCanManageClientTags(scope);
      for (const [position, id] of orderedIds.entries()) {
        await updateClientTagCached(writeClientOf(scope), id, { position }, scope.tenantId, scope.writeOpts);
      }
    },
    onSettled: () => invalidateClientTags(qc),
    meta: { errorHandled: true },
  });
}

export function useDeleteClientTag() {
  const scope = useQueryScope();
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => {
      assertCanManageClientTags(scope);
      return deleteClientTagCached(writeClientOf(scope), id, scope.tenantId, scope.writeOpts);
    },
    onSettled: () => invalidateClientTags(qc),
    meta: { errorHandled: true },
  });
}
