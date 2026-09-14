import type { UserRole } from "@/features/settings/role-policy";
import {
  accountBalancesQueryKey,
  accountRowsQueryKey,
  allServicesQueryKey,
  allTeamSchedulesQueryKey,
  appointmentsQueryKey,
  calendarSettingsQueryKey,
  citiesQueryKey,
  clientTagsQueryKey,
  clientsQueryKey,
  dayCitiesQueryKey,
  dayExtrasQueryKey,
  financeCategoriesQueryKey,
  invoicePaymentsQueryKey,
  invoicesQueryKey,
  ledgerRangeQueryKey,
  mastersQueryKey,
  refundTotalsQueryKey,
  servicesQueryKey,
  teamScheduleQueryKey,
  teamsQueryKey,
  tenantQueryKey,
} from "./company-query-keys";

// ЧТО ГРЕТЬ У ДРУГОЙ КОМПАНИИ, ЧТОБЫ ПЕРЕХОД В НЕЁ БЫЛ ПЕРВЫМ КАДРОМ С ДАННЫМИ.
//
// Владелец 2026-09-13: «нажимаю на Команду 1 — идёт загрузка… должно
// заранее погружаться… тык-тык и всё». «Загрузка» — это гейты экранов:
// календарь ждёт семь запросов (`(home)/index.tsx`, `calendarLoading`),
// финансы — двенадцать, клиенты — два. Пока хоть один из них без данных,
// экран рисует скелет. Значит прогрев обязан положить в кэш РОВНО ЭТИ ключи
// — и ни один не должен разойтись с тем, что спросит экран.
//
// Поэтому план — чистая функция в листе без зависимостей: на входе компания,
// роль, команды и период, на выходе список ключей в порядке приоритета.
// Тест сверяет список строкой; исполнитель (`tenant-prefetch.ts`) только
// ходит за данными. Роль здесь — роль человека В ТОЙ компании: у мастера и
// у владельца и ключи разные (`rolePart`), и чтения разные.
//
// Две волны, потому что вторая зависит от первой: без списка команд не собрать
// ключи городов и расписаний (они именные по команде), без настроек календаря
// не узнать часовой пояс, по которому финансы считают «текущий месяц».

export type WarmKind =
  | "tenant"
  | "calendar-settings"
  | "teams"
  | "teams-all"
  | "appointments"
  | "services"
  | "services-all"
  | "cities"
  | "day-cities"
  | "team-schedule"
  | "team-schedules-all"
  | "day-extras"
  | "clients"
  | "client-tags"
  | "masters"
  | "masters-all"
  | "finance-categories"
  | "transactions"
  | "refund-totals"
  | "invoices"
  | "invoice-payments"
  | "account-rows"
  | "account-balances";

export interface WarmTarget {
  kind: WarmKind;
  queryKey: readonly unknown[];
  /** Команда — для городов и расписания одной команды. `null` у городов —
   *  «все города компании» (так читает экран, которому нужно назвать метку). */
  teamId?: string | null;
  /** Границы среза журнала, YYYY-MM-DD включительно. */
  from?: string;
  to?: string;
}

export interface CompanyGateInput {
  tenantId: string;
  role: UserRole;
}

/** Первая волна: профиль, настройки календаря, команды. Всё, чего не хватает
 *  гейту «Открываем компанию» и границам прав, — и то, из чего собирается
 *  вторая волна. */
export function planCompanyGate({
  tenantId,
  role,
}: CompanyGateInput): WarmTarget[] {
  return [
    { kind: "tenant", queryKey: tenantQueryKey(tenantId, role) },
    {
      kind: "calendar-settings",
      queryKey: calendarSettingsQueryKey(tenantId, role),
    },
    { kind: "teams", queryKey: teamsQueryKey(tenantId, role, false) },
    { kind: "teams-all", queryKey: teamsQueryKey(tenantId, role, true) },
  ];
}

export interface CompanyWarmInput extends CompanyGateInput {
  /** Все команды компании (и архивные тоже: их чип виден, их можно выбрать). */
  teamIds: readonly string[];
  /** Период финансов по умолчанию — текущий месяц в часовом поясе компании. */
  period: { from: string; to: string };
  /** Роль видит деньги (`can(role, "view-finances")`). Считается снаружи:
   *  политика ролей тянет за собой готовность чатов, а лист обязан оставаться
   *  без зависимостей, чтобы подниматься под раннером. */
  canViewFinances: boolean;
}

/** Вторая волна, в порядке приоритета: сначала календарь (он открыт первым
 *  после перехода), потом клиенты, кабинет, деньги. */
export function planCompanyWarm({
  tenantId,
  role,
  teamIds,
  period,
  canViewFinances,
}: CompanyWarmInput): WarmTarget[] {
  const targets: WarmTarget[] = [
    { kind: "appointments", queryKey: appointmentsQueryKey(tenantId, role) },
    { kind: "services", queryKey: servicesQueryKey(tenantId, role) },
    { kind: "services-all", queryKey: allServicesQueryKey(tenantId, role) },
    // Экран календаря читает города ВЫБРАННОЙ команды; какая будет выбрана
    // после перехода, решает привычка устройства — греем каждую, справочник
    // маленький. Плюс «без команды»: так читают экраны прошлого.
    { kind: "cities", queryKey: citiesQueryKey(tenantId, false, null), teamId: null },
    ...teamIds.map(
      (teamId): WarmTarget => ({
        kind: "cities",
        queryKey: citiesQueryKey(tenantId, false, teamId),
        teamId,
      }),
    ),
    { kind: "day-cities", queryKey: dayCitiesQueryKey(tenantId, role) },
    ...teamIds.map(
      (teamId): WarmTarget => ({
        kind: "team-schedule",
        queryKey: teamScheduleQueryKey(tenantId, role, teamId),
        teamId,
      }),
    ),
  ];
  if (role === "owner") {
    targets.push(
      {
        kind: "team-schedules-all",
        queryKey: allTeamSchedulesQueryKey(tenantId, role),
      },
      { kind: "day-extras", queryKey: dayExtrasQueryKey(tenantId, role) },
    );
  }
  targets.push(
    { kind: "clients", queryKey: clientsQueryKey(tenantId, role) },
    { kind: "client-tags", queryKey: clientTagsQueryKey(tenantId, role) },
    { kind: "masters", queryKey: mastersQueryKey(tenantId, role, false) },
    { kind: "masters-all", queryKey: mastersQueryKey(tenantId, role, true) },
  );
  if (canViewFinances) {
    targets.push(
      {
        kind: "finance-categories",
        queryKey: financeCategoriesQueryKey(tenantId),
      },
      {
        kind: "transactions",
        queryKey: ledgerRangeQueryKey(tenantId, period.from, period.to, null, null),
        from: period.from,
        to: period.to,
      },
      { kind: "refund-totals", queryKey: refundTotalsQueryKey(tenantId) },
      { kind: "invoices", queryKey: invoicesQueryKey(tenantId) },
      { kind: "invoice-payments", queryKey: invoicePaymentsQueryKey(tenantId) },
      { kind: "account-rows", queryKey: accountRowsQueryKey(tenantId, false) },
      { kind: "account-balances", queryKey: accountBalancesQueryKey(tenantId) },
    );
  }
  return targets;
}
