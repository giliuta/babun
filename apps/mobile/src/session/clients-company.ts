import type { ClientsScope } from "./clients-company/scope";

// «КЛИЕНТЫ» — ОБЩАЯ СТРАНИЦА ДЛЯ ВСЕГО. Переход в Команду 1 и открытие клиентов
// открывает клиентов Y&D; если тот, кто поделился Командой 1, одобряет — видим
// ещё и клиентов Команды 1; если не подтвердил — всё равно видим клиентов,
// просто не видим его. Вся страница и вся архитектура остаются.
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
//
// Public entry: scopes and capabilities live in `./clients-company/scope`,
// the tab sources in `./clients-company/sources`, the route gate in
// `./clients-company/route`; links of the tab stay here.

export {
  capabilitiesOf,
  type ClientsCapabilities,
  type ClientsCompanyKind,
  type ClientsLevel,
  type ClientsScope,
  type CompanyAccess,
  type MembershipRow,
} from "./clients-company/scope";
export {
  clientsCompany,
  clientsSources,
  memberScope,
  viewKeyOf,
  type ClientsCompany,
  type ClientsCompanyInput,
  type ClientsSources,
  type ClientsSourcesInput,
} from "./clients-company/sources";
export {
  activeCompanyScope,
  clientsRouteDecision,
  type RouteDecision,
  type RouteInput,
  type RouteKind,
} from "./clients-company/route";

// ИНСТРУМЕНТЫ ШАПКИ НЕ ЗАВИСЯТ ОТ ТОГО, ЧТО ОТКРЫТО В КАЛЕНДАРЕ.
//
// Шапка выглядит одинаково везде: шестерёнка слева вверху, как и в любой
// другой вкладке, а в клиентах она открывает настройки МОИХ клиентов в любом
// случае. Если гасить шестерёнку и аналитику, пока своя компания не открыта в
// календаре, — в «Команде 1» шапка оставалась бы без них, и это читалось бы как
// «настройки пропали». Своя компания у вкладки есть всегда (`sources.primary`),
// поэтому и дверь в её хозяйство есть всегда.

/** Дверь в настройки клиентов: своя компания, даже если открыта другая.
 *  Ворота вкладки без `?tenant=` и так берут свою — ссылка остаётся прежней. */
export function clientsSettingsHref() {
  return "/clients/settings" as const;
}

/** Аналитика открывается ВНУТРИ вкладки «Клиенты» (адрес
 *  Кабинета зажигал внизу «Кабинет», и «Назад» уводил на чужой экран).
 *  Своя компания едет в ссылке: по ней экран берёт источник. Своя открыта —
 *  ссылка без хвоста. */
export function clientsInsightsHref(scope: ClientsScope) {
  return {
    pathname: "/clients/insights" as const,
    params: scope.isActive ? {} : { tenant: scope.tenantId },
  };
}

/** Ссылка на карточку клиента ВНУТРИ вкладки: компания едет в `?tenant=`. */
export function clientCardHref(id: string, tenantId: string) {
  return { pathname: "/clients/[id]" as const, params: { id, tenant: tenantId } };
}

/** Карточка СВОЕГО клиента из вкладки (строка списка, «Удалённые клиенты»,
 *  «Создать клиента» — `id = "new"`). Пока в календаре открыта команда
 *  партнёра, активна чужая компания, и ссылка без `?tenant=` уводила ворота
 *  карточки туда: 15 секунд загрузки и «Клиент не найден», а новый клиент
 *  заводился бы в базу работодателя. Своя открыта — ссылка прежняя. */
export function ownClientCardHref(
  id: string,
  scope: { tenantId: string; isActive: boolean } | null | undefined,
) {
  return scope && !scope.isActive
    ? clientCardHref(id, scope.tenantId)
    : { pathname: "/clients/[id]" as const, params: { id } };
}

/** Параметры подстраницы карточки («Все объекты», «Люди», «Реквизиты»,
 *  «Файлы», «История»). Карточка клиента компании-работодателя открыта с
 *  `tenant` — и подстраница обязана унести его с собой, иначе откроется в
 *  АКТИВНОЙ компании: «это часть компании» или вечная загрузка, а правки
 *  уйдут не туда. */
export function clientSubParams(
  clientId: string,
  scope: { tenantId: string; isActive: boolean } | null | undefined,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    clientId,
    ...(scope && !scope.isActive ? { tenant: scope.tenantId } : {}),
    ...extra,
  };
}

/** Отказ записи без сети, когда правится не активная компания. */
export function offlineForeignWriteMessage(tenantName: string | null): string {
  const whose = tenantName ? `Клиенты «${tenantName}»` : "Клиенты вашей компании";
  return `Нет интернета. ${whose} сохраняются только онлайн, пока в календаре открыта другая компания — подключитесь и повторите.`;
}
