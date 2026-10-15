import { useMemo } from "react";
import type { Client } from "@babun/shared/local/clients";
import { useMirror } from "@/session/mirror-state";
import { supabase } from "@/lib/supabase";
import { tenantBoundClient } from "@/lib/tenant-bound-client";
import { useTenantId } from "@/lib/tenant";
import { useCurrentRole, type UserRole } from "@/session/tenant";
import { useClientsScopeOrNull } from "@/session/company-scope";
import {
  activeCompanyScope,
  capabilitiesOf,
  memberScope,
  offlineForeignWriteMessage,
  viewKeyOf,
  type ClientsCompanyKind,
  type ClientsScope,
} from "@/session/clients-company";
import {
  clientBlockLevel,
  type ClientCardBlock,
} from "@/features/clients/client-block-access";
import { clientsAccessOf } from "@/features/clients/clients-access";
import { useMyAccess } from "@/session/access-queries";

// ИСТОЧНИК ЭКРАНА: СВОЯ КОМПАНИЯ, КОМПАНИЯ-РАБОТОДАТЕЛЬ ИЛИ КЛИЕНТ ЗАПИСИ.
//
// Вкладка «Клиенты» стала общей страницей (STORY-082): список склеен из своей
// компании и тех, где человеку открыли клиентов, а карточка живёт в компании
// своей строки. Источник объявляет экран (`company-scope.tsx`), хуки его
// читают. ВНЕ ВКЛАДКИ ПРОВАЙДЕРА НЕТ — и всё работает как раньше, по активной
// компании и роли: так зовут эти хуки форма записи, пикеры и «Финансы дня».
export interface QueryScope {
  tenantId: string | null;
  role: UserRole | null | undefined;
  kind: ClientsCompanyKind;
  /** Сотрудник вне вкладки: к его окну клиентов добавляются клиенты его
   *  записей (`list_master_clients_safe`) — см. `useQueryScope`. */
  withRecordClients?: boolean;
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

export function useQueryScope(): QueryScope {
  const scope = useClientsScopeOrNull();
  const activeTenantId = useTenantId();
  const roleQuery = useCurrentRole();
  const activeRole = roleQuery.data;
  const mirror = useMirror();
  const myAccess = useMyAccess();
  if (scope) {
    const fromProvider = scopeOf(scope);
    // КАРТОЧКА ИЗ ЗАПИСИ: маршрут карточки, открытой из записи
    // или календаря, даёт мастеру источник активной компании — окно
    // сотрудника. Клиент его записи вне этого окна отвечал «не найден», хотя
    // в форме записи он виден. В активной компании мастер читает окно плюс
    // клиентов своих записей — так же, как вне вкладки.
    if (!mirror && fromProvider.kind === "member" && scope.isActive && activeRole === "master") {
      return { ...fromProvider, withRecordClients: true, view: `${fromProvider.view}+records` };
    }
    return fromProvider;
  }
  // ЗЕРКАЛО ВНЕ ВКЛАДКИ (выбор клиента в записи и календаре). Дверь мастера
  // (`list_master_clients_safe`) по токену владельца отдаёт пусто — в
  // «его глазами» выбор клиента был бы пуст. Источник — тот
  // же, что собирает вкладка «Клиенты» в зеркале: он партнёр этой компании,
  // а строки доводит до его прав покров зеркала (`useMirroredMemberMap`).
  if (mirror && activeTenantId) {
    const mirrored = memberScope(
      activeTenantId,
      mirror.role,
      { isOwner: false, ...clientsAccessOf(mirror.map) },
      new Map(),
      activeTenantId,
    );
    if (mirrored) return scopeOf(mirrored);
  }
  // СОТРУДНИК С ОТКРЫТОЙ БАЗОЙ ВНЕ ВКЛАДКИ. Если форма записи и выбор клиента
  // читают мастеру только «клиентов его записей» (`list_master_clients_safe`),
  // клиент, только что заведённый из записи, записей ещё не имеет — форма
  // его не найдёт, а второй заход упрётся в занятый номер. Поэтому, если в
  // компании календаря ему открыты клиенты, источник тот же, что во вкладке
  // (окно `list_member_clients` по его правам), и к нему добавлены клиенты
  // его записей — в командах, где база закрыта, запись свою он видит как раньше.
  if (!mirror && activeTenantId && activeRole === "master") {
    if (myAccess.isPending) {
      return {
        tenantId: activeTenantId,
        role: activeRole,
        kind: "record",
        view: "role-pending",
        ready: false,
        isActive: true,
        contacts: true,
        tenantName: null,
        writeOpts: undefined,
      };
    }
    const map = myAccess.data;
    const member = map
      ? memberScope(
          activeTenantId,
          activeRole,
          { isOwner: false, ...clientsAccessOf(map) },
          new Map(),
          activeTenantId,
        )
      : null;
    if (member) return { ...scopeOf(member), withRecordClients: true, view: `${viewKeyOf(member)}+records` };
  }
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

/** МОЖНО ЛИ ОТСЮДА ПРАВИТЬ КАРТОЧКУ КЛИЕНТА. Мастер вне
 *  вкладки «Клиенты» читает «клиента записи» безопасной дверью, и любая
 *  правка карточки отсюда отказывает (`saveClient`, kind "record") — экран
 *  записи не должен её обещать: заметка клиента и объекты там только
 *  читаются. */
export function useClientCardWritable(
  client: Pick<Client, "blocks"> | null | undefined,
): (block: ClientCardBlock) => boolean {
  const kind = useQueryScope().kind;
  // Сотрудник с открытой базой читает и вне вкладки окном сотрудника
  // (`useQueryScope`). Правка — ровно как пустит сервер
  // (`update_client_with_tags`): клиент из его окна (у строки есть `blocks`)
  // и блок этого клиента открыт на «Меняет». Клиент «только его записей»
  // блоков не несёт — его карточка отсюда только читается.
  return (block) => {
    if (kind === "record") return false;
    if (kind !== "member") return true;
    return !!client?.blocks && clientBlockLevel(client, block) === "write";
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

export function scopeOf(scope: ClientsScope): QueryScope {
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
export function assertOwnCompany(scope: QueryScope, what: string): asserts scope is QueryScope & { tenantId: string } {
  if (!scope.tenantId) throw new Error("Аккаунт ещё не открыт — попробуйте ещё раз");
  if (scope.kind !== "own") {
    throw new Error(`${what} можно только в своей компании.`);
  }
}

/** Клиент Supabase источника: активная компания — обычный, остальные —
 *  привязанный заголовком к своей компании. */
export function writeClientOf(scope: QueryScope) {
  return scope.isActive ? supabase : tenantBoundClient(scope.tenantId as string);
}

/** Карта прав зеркала — только когда владелец смотрит глазами сотрудника на
 *  клиентов компании-работодателя; иначе `null` и строки как есть. */
export function useMirroredMemberMap(kind: string) {
  const mirror = useMirror();
  return mirror && kind === "member" ? mirror.map : null;
}
