import { can, isUserRole, type UserRole } from "../settings/role-policy";

// «КЛИЕНТЫ» — ОБЩАЯ СТРАНИЦА ДЛЯ ВСЕГО (владелец 19.09).
//
// «Когда я перехожу в Команду 1 и потом открываю клиентов — оно должно
// открывать клиентов Y&D; если человек, который поделился Командой 1,
// одобряет, чтобы мы видели клиентов, — тогда видим ещё и клиентов Команды 1;
// если не подтвердил — всё равно видим клиентов, просто не видим его… вся
// страница, вся архитектура остаётся».
//
// Значит, вкладка живёт не в одной компании, а в НЕСКОЛЬКИХ ИСТОЧНИКАХ:
//   • СВОЯ компания (где человек владелец) — вся база со всем, что есть
//     сегодня: создание, импорт, архив, корзина, теги, массовые действия;
//   • компания-РАБОТОДАТЕЛЬ — только если её владелец выставил «Клиенты:
//     Смотрит» или «Меняет». Что именно видно (все клиенты или из его
//     календарей) и видны ли телефоны, решают его же уровни;
//   • клиент ЗАПИСИ — старая дорога мастера: он открывает карточку клиента из
//     своей заявки, даже когда базы у него нет вовсе.
//
// Лист без react-native: правило решает, ЧТО показывает вкладка и что в каждом
// источнике можно. Экраны только читают ответ.

/** Своё членство: компания, роль в ней, дата вступления (`tenant_members`). */
export interface MembershipRow {
  tenantId: string;
  role: string;
  joinedAt: string;
}

/** Положение блока клиентов в чужой компании — как его отдаёт карта прав. */
export type ClientsLevel = "off" | "read" | "write";

/** Права человека в одной компании, собранные из `my_access_map()`. */
export interface CompanyAccess {
  isOwner: boolean;
  /** `undefined` — блок ещё не живой или карта без него: значит «Скрыт». */
  clients?: string;
  /** «own» — из его календарей, «all» — все клиенты компании. */
  scope?: string;
  /** «read» — телефоны видны. */
  contacts?: string;
}

export type ClientsCompanyKind = "own" | "member" | "record";

/** Компания вкладки и то, что в ней можно. */
export interface ClientsScope {
  tenantId: string;
  tenantName: string | null;
  kind: ClientsCompanyKind;
  /** Роль человека в этой компании. */
  role: UserRole;
  /** «Смотрит» или «Меняет». У своей компании — всегда «Меняет». */
  level: Exclude<ClientsLevel, "off">;
  /** Видны ли телефоны, почта и мессенджеры. */
  contacts: boolean;
  /** «Все клиенты компании» вместо «из его календарей». */
  everyClient: boolean;
  /** Компания открыта в календаре: чтения и записи идут обычным клиентом. */
  isActive: boolean;
}

/** Что разрешено в этом источнике. Одно место на весь экран: строка списка,
 *  свайпы, футер, карточка и её блоки спрашивают отсюда, а не считают сами. */
export interface ClientsCapabilities {
  /** Полная база: архив, корзина, справочник тегов, импорт, массовые действия,
   *  шестерёнка. Это хозяйство СВОЕЙ компании. */
  manage: boolean;
  /** «Создать клиента». */
  create: boolean;
  /** Правка карточки. */
  edit: boolean;
  /** Телефоны, WhatsApp, почта. */
  contacts: boolean;
  /** Деньги клиента: ожидаемое, доход, долг. Чужие суммы сотруднику не
   *  приходят вовсе, поэтому в строке их нет — вместо нулей. */
  money: boolean;
  /** «Записать» — запись живёт в календаре, открытом сейчас, поэтому она
   *  возможна ровно у клиента ТОЙ компании, что сейчас открыта: и у своего,
   *  и у клиента работодателя, в чьём календаре человек и работает. */
  book: boolean;
  /** Файлы и фото: хранилище читает компанию из токена, а не из заголовка. */
  files: boolean;
  /** Правка уходит на сервер сразу; очереди на потом нет. */
  onlineOnly: boolean;
}

export function capabilitiesOf(scope: ClientsScope): ClientsCapabilities {
  const own = scope.kind === "own";
  const record = scope.kind === "record";
  return {
    manage: own,
    // ЗАВОДИТЬ КЛИЕНТОВ МОЖЕТ И СОТРУДНИК С «МЕНЯЕТ». Право было привязано к
    // владению компанией, и кнопка стояла серой у человека, которому сервер
    // это РАЗРЕШАЕТ: `create_client_with_tags` пускает `owner` или
    // `access_company('clients','write')`, а дорога записи в чужую компанию
    // давно написана (`useCreateClient`, ветка `member`). Фраза права при
    // этом обещала ровно это — «Заводит клиентов и правит их карточки»
    // (найдено зеркалом 20.09).
    create: !record && scope.level === "write",
    edit: !record && scope.level === "write",
    contacts: scope.contacts,
    money: own,
    book: !record && scope.isActive,
    files: own && scope.isActive,
    onlineOnly: !scope.isActive || scope.kind === "member",
  };
}

export type ClientsCompany =
  | { kind: "company"; scope: ClientsScope }
  | { kind: "none" }
  | { kind: "unknown" };

export interface ClientsCompanyInput {
  activeTenantId: string | null;
  /** `undefined` — роль ещё не пришла; `null` — роли в активной компании нет. */
  activeRole: UserRole | null | undefined;
  /** `undefined` — членства ещё не пришли. */
  memberships: readonly MembershipRow[] | undefined;
  names: ReadonlyMap<string, string>;
}

function ownScope(
  tenantId: string,
  names: ReadonlyMap<string, string>,
  activeTenantId: string | null,
): ClientsScope {
  return {
    tenantId,
    tenantName: names.get(tenantId) ?? null,
    kind: "own",
    role: "owner",
    level: "write",
    contacts: true,
    everyClient: true,
    isActive: tenantId === activeTenantId,
  };
}

function joinedOrder(a: MembershipRow, b: MembershipRow): number {
  const at = Date.parse(a.joinedAt);
  const bt = Date.parse(b.joinedAt);
  if (!Number.isNaN(at) && !Number.isNaN(bt) && at !== bt) return at - bt;
  if (a.joinedAt !== b.joinedAt) return a.joinedAt < b.joinedAt ? -1 : 1;
  // Тот же добор, что у запасного пути `current_tenant_id()`.
  return a.tenantId < b.tenantId ? -1 : a.tenantId > b.tenantId ? 1 : 0;
}

/** СВОЯ компания вкладки: активная, если он её владелец, иначе самая ранняя
 *  из своих. Своей нет — `none`. */
export function clientsCompany(input: ClientsCompanyInput): ClientsCompany {
  const { activeTenantId, activeRole, memberships, names } = input;

  if (activeTenantId && activeRole === "owner") {
    return { kind: "company", scope: ownScope(activeTenantId, names, activeTenantId) };
  }
  // Роль ещё в пути, а членства уже знают: активная — своя.
  if (
    activeTenantId &&
    activeRole === undefined &&
    memberships?.some((m) => m.tenantId === activeTenantId && m.role === "owner")
  ) {
    return { kind: "company", scope: ownScope(activeTenantId, names, activeTenantId) };
  }
  if (!memberships) return { kind: "unknown" };

  // Строка членств бывает старее роли: если сервер уже сказал «мастер»,
  // активная компания не своя, что бы ни помнил список.
  const activeIsNotOwned = activeRole !== undefined && activeRole !== "owner";
  const owned = memberships
    .filter((m) => m.role === "owner")
    .filter((m) => !(activeIsNotOwned && m.tenantId === activeTenantId))
    .slice()
    .sort(joinedOrder);
  const first = owned[0];
  return first
    ? { kind: "company", scope: ownScope(first.tenantId, names, activeTenantId) }
    : { kind: "none" };
}

/** Источник-работодатель: компания, где человек работает, а её владелец
 *  открыл ему клиентов. Карта прав ещё не приехала (`undefined`) — источника
 *  пока нет, он появится сам. */
export function memberScope(
  tenantId: string,
  role: UserRole,
  access: CompanyAccess | undefined,
  names: ReadonlyMap<string, string>,
  activeTenantId: string | null,
): ClientsScope | null {
  if (!access || access.isOwner) return null;
  const level = access.clients;
  if (level !== "read" && level !== "write") return null;
  return {
    tenantId,
    tenantName: names.get(tenantId) ?? null,
    kind: "member",
    role,
    level,
    contacts: access.contacts === "read",
    everyClient: access.scope === "all",
    isActive: tenantId === activeTenantId,
  };
}

export interface ClientsSourcesInput extends ClientsCompanyInput {
  /** Карты прав компаний, где человек НЕ владелец. */
  access: ReadonlyMap<string, CompanyAccess | undefined>;
}

export interface ClientsSources {
  /** Членства ещё не приехали — рисуем ожидание, а не «клиентов нет». */
  loading: boolean;
  /** Своя компания: её хозяйство и её футер. */
  primary: ClientsScope | null;
  /** Все источники списка: своя первой, дальше работодатели по вступлению. */
  list: ClientsScope[];
  /** Компании, чьи карты прав нужно спросить. */
  needAccess: string[];
}

/** Что показывает вкладка «Клиенты» целиком. */
export function clientsSources(input: ClientsSourcesInput): ClientsSources {
  const company = clientsCompany(input);
  const primary = company.kind === "company" ? company.scope : null;
  const memberships = input.memberships;
  if (!memberships) {
    return { loading: company.kind === "unknown", primary, list: primary ? [primary] : [], needAccess: [] };
  }
  const employers = memberships
    .filter((m) => m.role !== "owner" && m.tenantId !== primary?.tenantId)
    .slice()
    .sort(joinedOrder);
  const list: ClientsScope[] = primary ? [primary] : [];
  const needAccess: string[] = [];
  for (const membership of employers) {
    needAccess.push(membership.tenantId);
    const role = isUserRole(membership.role) ? membership.role : null;
    if (!role) continue;
    const scope = memberScope(
      membership.tenantId,
      role,
      input.access.get(membership.tenantId),
      input.names,
      input.activeTenantId,
    );
    if (scope) list.push(scope);
  }
  return { loading: false, primary, list, needAccess };
}

/** Вид доступа для ключей запросов источника: у своей компании — роль (ключ
 *  остаётся прежним, прогрев греет то же), у работодателя — его уровни. */
export function viewKeyOf(scope: ClientsScope): string {
  if (scope.kind !== "member") return scope.role;
  return [
    "member",
    scope.level,
    scope.everyClient ? "all" : "own",
    scope.contacts ? "phones" : "hidden",
  ].join(":");
}

export type RouteKind = "tab" | "card" | "card-sub";

export type RouteDecision =
  | { state: "wait" }
  | { state: "words"; reason: "no-company" | "not-found" | "not-allowed" }
  | { state: "open"; scope: ClientsScope };

export interface RouteInput {
  kind: RouteKind;
  /** `?tenant=` ссылки; пусто — компания по умолчанию для вида экрана. */
  tenantParam?: string | null;
  activeTenantId: string | null;
  activeRole: UserRole | null | undefined;
  activeName: string | null;
  sources: ClientsSources;
  /** Вход из записи и календаря: карточка всегда в компании календаря. */
  forceActive?: boolean;
}

/** Карточка клиента ЗАПИСИ — старая дорога мастера: базы у него нет, но
 *  клиента своей заявки он открывает (безопасная функция сервера). */
function recordScope(tenantId: string, role: UserRole, name: string | null): ClientsScope {
  return {
    tenantId,
    tenantName: name,
    kind: "record",
    role,
    level: "read",
    contacts: true,
    everyClient: false,
    isActive: true,
  };
}

/** Что показать экрану клиентов. Вкладка — общая страница источников; карточка
 *  без `?tenant=` — компания календаря (так в неё приходят из записи). */
export function clientsRouteDecision(input: RouteInput): RouteDecision {
  const { kind, activeTenantId, activeRole, activeName, sources } = input;
  const tenantParam = input.tenantParam || null;

  if (kind === "tab") {
    if (sources.loading) return { state: "wait" };
    if (sources.list.length === 0) return { state: "words", reason: "no-company" };
    const primary = sources.primary ?? sources.list[0]!;
    if (tenantParam && tenantParam !== primary.tenantId) {
      const other = sources.list.find((scope) => scope.tenantId === tenantParam);
      return other ? { state: "open", scope: other } : { state: "words", reason: "not-found" };
    }
    return { state: "open", scope: primary };
  }

  const wantsActive = input.forceActive || !tenantParam || tenantParam === activeTenantId;
  if (wantsActive) {
    if (!activeTenantId || activeRole === undefined) return { state: "wait" };
    if (activeRole === null) return { state: "words", reason: "not-found" };
    const known = sources.list.find((scope) => scope.tenantId === activeTenantId);
    if (known) {
      // Визиты и вложения чужой компании сотруднику не открываем: это её
      // история и её файлы, а не карточка клиента. Записи он видит в календаре.
      if (kind === "card-sub" && known.kind !== "own") {
        return { state: "words", reason: "not-allowed" };
      }
      return { state: "open", scope: known };
    }
    if (can(activeRole, "operate-clients")) {
      return {
        state: "open",
        scope: {
          ...ownScope(activeTenantId, new Map(), activeTenantId),
          tenantName: activeName,
          role: activeRole,
        },
      };
    }
    // Мастер без базы открывает саму карточку клиента записи; её визиты и
    // вложения — нет.
    return kind === "card"
      ? { state: "open", scope: recordScope(activeTenantId, activeRole, activeName) }
      : { state: "words", reason: "not-allowed" };
  }

  if (sources.loading) return { state: "wait" };
  const source = sources.list.find((scope) => scope.tenantId === tenantParam);
  if (!source) return { state: "words", reason: "not-found" };
  if (kind === "card-sub" && source.kind !== "own") {
    return { state: "words", reason: "not-allowed" };
  }
  return { state: "open", scope: source };
}

// ИНСТРУМЕНТЫ ШАПКИ НЕ ЗАВИСЯТ ОТ ТОГО, ЧТО ОТКРЫТО В КАЛЕНДАРЕ.
//
// Владелец 20.09: «визуал вообще не меняется… как есть в моей команде это
// шестерёнка слева вверху, как и в любой другой… в клиентах оно открывает в
// любом случае, так как ни крути, настройки МОИХ клиентов». Первый заход
// гасил шестерёнку и аналитику, пока своя компания не открыта в календаре, —
// в «Команде 1» шапка оставалась без них, и это читалось как «настройки
// пропали». Своя компания у вкладки есть всегда (`sources.primary`), поэтому
// и дверь в её хозяйство есть всегда.

/** Дверь в настройки клиентов: своя компания, даже если открыта другая.
 *  Ворота вкладки без `?tenant=` и так берут свою — ссылка остаётся прежней. */
export function clientsSettingsHref() {
  return "/clients/settings" as const;
}

/** Аналитика клиентов живёт в Кабинете, а он смотрит на компанию УСТРОЙСТВА.
 *  Поэтому своя компания едет в ссылке: по ней экран берёт источник, а
 *  Кабинет — роль в компании экрана. Своя открыта — ссылка без хвоста. */
export function clientsInsightsHref(scope: ClientsScope) {
  return {
    pathname: "/cabinet/insights" as const,
    params: scope.isActive ? {} : { tenant: scope.tenantId },
  };
}

/** Ссылка на карточку клиента ВНУТРИ вкладки: компания едет в `?tenant=`. */
export function clientCardHref(id: string, tenantId: string) {
  return { pathname: "/clients/[id]" as const, params: { id, tenant: tenantId } };
}

/** Отказ записи без сети, когда правится не активная компания. */
export function offlineForeignWriteMessage(tenantName: string | null): string {
  const whose = tenantName ? `Клиенты «${tenantName}»` : "Клиенты вашей компании";
  return `Нет интернета. ${whose} сохраняются только онлайн, пока в календаре открыта другая компания — подключитесь и повторите.`;
}
