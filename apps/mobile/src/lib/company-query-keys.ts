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

// ИСТОЧНИК ВКЛАДКИ «КЛИЕНТЫ» — ТРЕТИЙ ЭЛЕМЕНТ НЕ РОЛЬ, А ВИД ДОСТУПА.
//
// У своей компании вид совпадает с ролью, и ключ остаётся прежним — прогрев
// греет то же самое. У компании-работодателя вид собран из уровней («Смотрит»
// или «Меняет», все клиенты или из его календарей, видны ли телефоны).
// Владелец поменял уровень — у списка другой ключ, и он перечитывается сам,
// без ручных сбросов и без риска показать данные по старому праву.
export const sourceClientsQueryKey = (tenantId: string | null, view: string) =>
  ["clients", tenantId, view] as const;

export const sourceClientTagsQueryKey = (tenantId: string | null, view: string) =>
  ["client-tags", tenantId, view] as const;

export const sourceClientQueryKey = (
  id: string,
  tenantId: string | null,
  view: string,
) => ["client", id, tenantId, view] as const;

// С 2026-09-15 `useTeams` читает только вариант с «all» (активные отбираются
// `select`); ключ без суффикса остался лишь у плана прогрева — до его правки.
export const teamsQueryKey = (
  tenantId: string | null,
  role: Role,
  includeInactive: boolean,
) =>
  includeInactive
    ? (["teams", tenantId, rolePart(role), "all"] as const)
    : (["teams", tenantId, rolePart(role)] as const);

// С 2026-09-15 `useCities` читает ключ с `teamId = null` (команда — `select`);
// ключи с командой остались лишь у плана прогрева — до его правки.
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

// С 2026-09-15 экраны читают только карту компании (`allTeamSchedulesQueryKey`,
// команда — `select`); ключ одной команды остался лишь у плана прогрева.
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

/** Срез журнала: и хук, и прогрев берут его одной функцией — разъехавшиеся
 *  ключи молча завели бы две копии месяца. С 2026-09-15 хук зовёт его с
 *  `null, null`: команду и счёт отбирает `select` (`finances/ledger-select.ts`),
 *  а тап по чипу команды не заводит нового ключа и не ходит в сеть. Места под
 *  срезы в ключе остались, чтобы не менять форму. */
export const ledgerRangeQueryKey = (
  tenantId: string | null | undefined,
  from: string,
  to: string,
  teamScope: readonly string[] | null,
  accountScope: readonly string[] | null,
) => ["transactions", tenantId, from, to, teamScope, accountScope] as const;

export const refundTotalsQueryKey = (tenantId: string | null) =>
  ["transactions", tenantId, "refund-totals"] as const;

// ДОЛГИ. Жили строкой внутри `useDebts` — переехали сюда тем же правилом, что
// журнал. Компания — ВТОРЫМ элементом, как у каждого ключа денег: заглушка
// загрузки (`placeholderWithinTenant`) узнаёт по нему, своя ли это компания.
// Команда в ключе — всегда `null` у хука (её отбирает `select`); первый
// сегмент `"debts"` — префикс, по которому сбрасывают долги мутации и экран.

export const debtsRangeQueryKey = (
  tenantId: string | null | undefined,
  from: string,
  to: string,
  teamId: string | null,
) => ["debts", tenantId, from, to, teamId] as const;

export const debtPaidTotalsQueryKey = (tenantId: string | null | undefined) =>
  ["debts", tenantId, "paid-totals"] as const;

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

/** VAT к уплате по одному счёту. Под «accounts»: любая правка денег, которая
 *  сбрасывает остатки, сбрасывает и его. */
export const accountVatDueQueryKey = (
  tenantId: string | null,
  accountId: string,
) => ["accounts", tenantId, "vat-due", accountId] as const;

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

/** СВОЯ карта прав человека в компании (`my_access_map`, этап 2). Компания во
 *  втором сегменте: переход её бережёт, уход из компании стирает, а сигнал
 *  `access_changed {tenant_id}` находит ровно этот ключ. */
export const myAccessQueryKey = (tenantId: string | null) =>
  ["my-access", tenantId] as const;

export const calendarMembersQueryKey = (tenantId: string | null, teamId: string | null) =>
  ["calendar-members", tenantId, teamId] as const;
