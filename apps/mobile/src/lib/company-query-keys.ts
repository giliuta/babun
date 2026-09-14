import type { UserRole } from "@/features/settings/role-policy";

// КЛЮЧИ ЗАПРОСОВ КОМПАНИИ — ОДНО ТЕЛО НА ПРОДУКТ.
//
// Прогрев чужой компании кладёт данные в react-query ПОД ТЕМИ ЖЕ КЛЮЧАМИ, под
// которыми их потом спросит экран. Разойдись ключ хоть на элемент — порядок,
// `role-pending`, суффикс `"all"` — прогрев будет греть то, что никто не
// спросит, а экран снова пойдёт в сеть; и заметить это глазами нельзя, кэш
// молча становится холодным. Поэтому ключи живут здесь, хуки их только зовут,
// а тест сверяет форму каждого со строкой.
//
// Лист без зависимостей (тип роли стирается при компиляции): под раннером
// поднимается, значит проверяем поведение, а не текст.

type Role = UserRole | null | undefined;
const rolePart = (role: Role): string => role ?? "role-pending";

export const currentRoleQueryKey = (tenantId: string | null) =>
  ["current-role", tenantId] as const;

export const appointmentsQueryKey = (tenantId: string | null, role: Role) =>
  ["appointments", tenantId, rolePart(role)] as const;

export const clientsQueryKey = (tenantId: string | null, role: Role) =>
  ["clients", tenantId, rolePart(role)] as const;

export const clientTagsQueryKey = (tenantId: string | null, role: Role) =>
  ["client-tags", tenantId, rolePart(role)] as const;

export const teamsQueryKey = (
  tenantId: string | null,
  role: Role,
  includeInactive: boolean,
) =>
  includeInactive
    ? (["teams", tenantId, rolePart(role), "all"] as const)
    : (["teams", tenantId, rolePart(role)] as const);

export const citiesQueryKey = (
  tenantId: string | null,
  includeInactive: boolean,
  teamId: string | null,
) => ["cities", tenantId, includeInactive ? "all" : "live", teamId] as const;

export const servicesQueryKey = (tenantId: string | null, role: Role) =>
  ["services", tenantId, rolePart(role)] as const;

export const allServicesQueryKey = (tenantId: string | null, role: Role) =>
  ["services", "with-archived", tenantId, rolePart(role)] as const;

export const calendarSettingsQueryKey = (tenantId: string | null, role: Role) =>
  ["calendar-settings", tenantId, rolePart(role)] as const;

export const dayCitiesQueryKey = (tenantId: string | null, role: Role) =>
  ["day-cities", tenantId, rolePart(role)] as const;

export const dayExtrasQueryKey = (tenantId: string | null, role: Role) =>
  ["day-extras", tenantId, rolePart(role)] as const;

export const teamScheduleQueryKey = (
  tenantId: string | null,
  role: Role,
  teamId: string | undefined,
) => ["team-schedules", tenantId, rolePart(role), teamId] as const;

export const allTeamSchedulesQueryKey = (tenantId: string | null, role: Role) =>
  ["team-schedules", tenantId, rolePart(role), "all"] as const;

export const tenantQueryKey = (tenantId: string | null, role: Role) =>
  ["tenant", tenantId, rolePart(role)] as const;

export const mastersQueryKey = (
  tenantId: string | null,
  role: Role,
  includeInactive: boolean,
) =>
  includeInactive
    ? (["masters", tenantId, rolePart(role), "all"] as const)
    : (["masters", tenantId, rolePart(role)] as const);

// ДЕНЬГИ. Ключи финансов и инвойсов жили строками внутри хуков — прогрев
// другой компании обязан греть ровно их, поэтому они переехали сюда. Форма
// каждого сверяется тестом с тем, что стояло в хуке до переезда.

export const financeCategoriesQueryKey = (tenantId: string | null) =>
  ["finance-categories", tenantId] as const;

/** Срез журнала: и хук, и разовая дозагрузка выписки, и прогрев берут его
 *  одной функцией — разъехавшиеся ключи молча завели бы две копии месяца. */
export const ledgerRangeQueryKey = (
  tenantId: string | null | undefined,
  from: string,
  to: string,
  teamScope: readonly string[] | null,
  accountScope: readonly string[] | null,
) => ["transactions", tenantId, from, to, teamScope, accountScope] as const;

export const refundTotalsQueryKey = (tenantId: string | null) =>
  ["transactions", tenantId, "refund-totals"] as const;

export const invoicesQueryKey = (tenantId: string | null) =>
  ["invoices", tenantId] as const;

export const invoicePaymentsQueryKey = (tenantId: string | null) =>
  ["invoices", tenantId, "payments"] as const;

export const accountRowsQueryKey = (
  tenantId: string | null,
  includeInactive: boolean,
) => ["accounts", tenantId, "rows", includeInactive ? "all" : "active"] as const;

export const accountBalancesQueryKey = (tenantId: string | null) =>
  ["accounts", tenantId, "balances"] as const;

/** Кассы, куда можно принять деньги по заявке команды. Сбрасывается вместе со
 *  счетами (`invalidateAccounts`), поэтому первый сегмент — свой, отдельный. */
export const paymentAccountsQueryKey = (
  tenantId: string | null,
  teamId: string | null | undefined,
) => ["payment-accounts", tenantId, teamId ?? "no-team"] as const;

// ПРАВА СОТРУДНИКОВ (STORY-081, «Контракт v1.1» сессии 006). Реестр блоков
// общий для всех компаний, поэтому без компании в ключе; карта прав человека и
// люди календаря принадлежат компании.
export const accessBlocksQueryKey = () => ["access-blocks"] as const;

export const memberAccessQueryKey = (tenantId: string | null, userId: string | null) =>
  ["member-access", tenantId, userId] as const;

export const calendarMembersQueryKey = (tenantId: string | null, teamId: string | null) =>
  ["calendar-members", tenantId, teamId] as const;
