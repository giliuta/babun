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
  teamsQueryKey,
  tenantQueryKey,
} from "./company-query-keys";

// ЧТО ГРЕТЬ, ЧТОБЫ ПЕРЕХОД В КОМПАНИЮ БЫЛ ПЕРВЫМ КАДРОМ С ДАННЫМИ.
//
// Владелец 2026-09-13: «нажимаю на Команду 1 — идёт загрузка… должно
// заранее погружаться… тык-тык и всё». «Загрузка» — это гейты экранов:
// календарь ждёт свои запросы (`(home)/index.tsx`, `calendarLoading`),
// финансы — свои, клиенты — свои. Пока хоть один из них без данных, экран
// рисует скелет. Значит прогрев обязан положить в кэш РОВНО ЭТИ ключи — и ни
// один не должен разойтись с тем, что спросит экран. Тест сверяет каждый
// ключ плана с тем, который строит хук (`tenant-prefetch-plan.test.ts`).
//
// Поэтому план — чистая функция в листе без зависимостей: на входе компании,
// роли и период, на выходе список ключей в порядке приоритета. Исполнитель
// (`tenant-prefetch.ts`) только ходит за данными. Роль здесь — роль человека
// В ТОЙ компании: у мастера и у владельца и ключи разные (`rolePart`), и
// чтения разные.
//
// КЛЮЧИ КОМПАНИИ, А НЕ КОМАНДЫ (2026-09-15). Экран календаря больше не читает
// метки и графики по команде: одна карта на компанию, команда — `select`
// (`reference/queries.ts`, `team-schedule.ts`). Прежние цели «метки команды X»
// и «график команды X» грели ключи, которые никто уже не спросит, — и тратили
// очередь бесплатного тарифа, из-за которой переход и ждёт.

export type WarmKind =
  | "tenant"
  | "calendar-settings"
  | "teams-all"
  | "appointments"
  | "services-all"
  | "cities"
  | "day-cities"
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
  /** Границы среза журнала, YYYY-MM-DD включительно. */
  from?: string;
  to?: string;
}

export interface CompanyGateInput {
  tenantId: string;
  role: UserRole;
}

/** Гейт компании: профиль, настройки календаря, команды. Всё, чего ждёт
 *  «Открываем компанию» и границы прав; из настроек же берётся часовой пояс,
 *  по которому финансы считают «текущий месяц». Команды — только полным
 *  списком: `useTeams` читает его и для активных (`select`). */
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
    { kind: "teams-all", queryKey: teamsQueryKey(tenantId, role, true) },
  ];
}

/** Календарь, клиенты, кабинет — в порядке приоритета: календарь открыт
 *  первым после перехода. */
export function planCompanyCalendar({
  tenantId,
  role,
}: CompanyGateInput): WarmTarget[] {
  const targets: WarmTarget[] = [
    { kind: "appointments", queryKey: appointmentsQueryKey(tenantId, role) },
    // Услуги — одним полным списком: `useServices` читает его и для живых
    // (`select`), второй ключ за той же таблицей был бы вторым запросом.
    { kind: "services-all", queryKey: allServicesQueryKey(tenantId, role) },
    { kind: "cities", queryKey: citiesQueryKey(tenantId, false, null) },
    { kind: "day-cities", queryKey: dayCitiesQueryKey(tenantId, role) },
    // Карта графиков — любой роли: с 2026-09-15 её читает `useTeamSchedule`
    // у каждого, а не только список календарей владельца.
    {
      kind: "team-schedules-all",
      queryKey: allTeamSchedulesQueryKey(tenantId, role),
    },
  ];
  // Ручные операции дня хук включает только владельцу — другим не греем.
  if (role === "owner") {
    targets.push({ kind: "day-extras", queryKey: dayExtrasQueryKey(tenantId, role) });
  }
  targets.push(
    { kind: "clients", queryKey: clientsQueryKey(tenantId, role) },
    { kind: "client-tags", queryKey: clientTagsQueryKey(tenantId, role) },
    { kind: "masters", queryKey: mastersQueryKey(tenantId, role, false) },
    { kind: "masters-all", queryKey: mastersQueryKey(tenantId, role, true) },
  );
  return targets;
}

/** Деньги. Ключи без роли: право видеть их решает `canViewFinances` снаружи
 *  и RLS на сервере. Долги, НДС, архивные счета и журнал недели сюда пока не
 *  входят: их хуки живут в файлах финансов, которые сейчас переделываются
 *  (шаг «финансы без пригасания»), — греть ключи, которые вот-вот сменят
 *  форму, значит греть мимо. */
export function planCompanyFinances({
  tenantId,
  period,
}: {
  tenantId: string;
  period: { from: string; to: string };
}): WarmTarget[] {
  return [
    { kind: "finance-categories", queryKey: financeCategoriesQueryKey(tenantId) },
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
  ];
}

// ─── Какие компании и в каком порядке ────────────────────────────────

export interface WarmCompany {
  tenantId: string;
  role: UserRole;
  /** Компания, открытая на устройстве сейчас. */
  active: boolean;
}

/** АКТИВНАЯ КОМПАНИЯ ТОЖЕ ГРЕЕТСЯ — но не всё. Хуки этих ключей делают больше,
 *  чем читают: ставят валюту форматтеров (`useTenant`), пишут настройки в
 *  MMKV (`useCalendarSettings`), читают через офлайн-обёртку SQLite
 *  (`useAppointments`, `useClients`, `useClientTags`). Положи прогрев свой
 *  ответ под их ключ — экран возьмёт его как свежий, и действие хука не
 *  случится: снимок SQLite останется старым, валюта — прежней. Эти ключи
 *  активной компании и так грузит её открытый экран. Тест выводит список из
 *  исходников хуков: новый такой хук без строки здесь его уронит. */
export const ACTIVE_COMPANY_SKIPS: ReadonlySet<WarmKind> = new Set<WarmKind>([
  "tenant",
  "calendar-settings",
  "appointments",
  "clients",
  "client-tags",
]);

/** Компании к прогреву: сначала активная, потом остальные в порядке ленты,
 *  каждая один раз (в ленте по строке на календарь). Роль активной — из
 *  опроса роли (`current_user_role`), а не из ленты: границы прав экрана
 *  стоят на ней. Роль ещё неизвестна — активную не греем вовсе (fail closed):
 *  её экран сам дождётся роли, а прогрев вернётся со следующим поводом. */
export function companiesToWarm({
  calendars,
  activeTenantId,
  activeRole,
}: {
  calendars: readonly { tenantId: string; role: UserRole }[];
  activeTenantId: string;
  activeRole: UserRole | null;
}): WarmCompany[] {
  const companies: WarmCompany[] = [];
  if (activeRole) {
    companies.push({ tenantId: activeTenantId, role: activeRole, active: true });
  }
  const seen = new Set<string>([activeTenantId]);
  for (const calendar of calendars) {
    if (seen.has(calendar.tenantId)) continue;
    seen.add(calendar.tenantId);
    companies.push({ tenantId: calendar.tenantId, role: calendar.role, active: false });
  }
  return companies;
}

export interface WarmJob {
  tenantId: string;
  target: WarmTarget;
}

/** ПЕРВАЯ ВОЛНА — В ШИРИНУ: гейт и календарь КАЖДОЙ компании, и только потом
 *  деньги. Иначе очередь сначала выбирала бы до дна финансы активной, а
 *  календарь другой компании — то, из-за чего переход и показывает скелет, —
 *  ждал бы за ними. */
export function planCalendarWave(companies: readonly WarmCompany[]): WarmJob[] {
  return companies.flatMap((company) =>
    [...planCompanyGate(company), ...planCompanyCalendar(company)]
      .filter((target) => !(company.active && ACTIVE_COMPANY_SKIPS.has(target.kind)))
      .map((target) => ({ tenantId: company.tenantId, target })),
  );
}

/** Вторая волна — деньги тех компаний, где роль их видит и где период
 *  известен (его даёт часовой пояс из настроек, прочитанных первой волной). */
export function planFinanceWave(
  companies: readonly (WarmCompany & {
    canViewFinances: boolean;
    period: { from: string; to: string } | null;
  })[],
): WarmJob[] {
  return companies.flatMap((company) =>
    company.canViewFinances && company.period
      ? planCompanyFinances({ tenantId: company.tenantId, period: company.period }).map(
          (target) => ({ tenantId: company.tenantId, target }),
        )
      : [],
  );
}

// ─── Очередь: по двое и только в тишине ──────────────────────────────

/** Экран занят, если в полёте чужое для прогрева чтение или идёт запись.
 *
 *  Своё чтение прогрева не в счёт: иначе каждый из двух рабочих принимал бы
 *  чтение другого за экран, и очередь по двое шла бы гуськом с лишними
 *  паузами. Запись в счёт всегда: ответ прогрева, приземлившийся между
 *  оптимистичной правкой и её сохранением, вернул бы на экран старое. */
export function screensBusyFrom(input: {
  fetchingHashes: Iterable<string>;
  warmingHashes: ReadonlySet<string>;
  mutating: number;
}): boolean {
  if (input.mutating > 0) return true;
  for (const hash of input.fetchingHashes) {
    if (!input.warmingHashes.has(hash)) return true;
  }
  return false;
}

export interface WarmQueueOptions<T> {
  /** Сколько чтений идёт разом. */
  concurrency: number;
  /** Нужна ли ещё работа: ключ мог прогреться сам (открыли экран). Спрашивается
   *  до ожидания тишины — тёплый ключ не стоит ожидания — и сразу после. */
  needed: (item: T) => boolean;
  /** Экран что-то грузит или пишет. */
  isBusy: () => boolean;
  /** Компания устройства сменилась — дальше не греть. */
  shouldStop: () => boolean;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  pollMs: number;
  /** Сколько тишина должна продержаться. Между ответом одного запроса экрана и
   *  стартом следующего бывает кадр, когда в полёте ничего нет, — прогрев не
   *  должен влезать в этот зазор. */
  settleMs: number;
  /** Дольше этого не ждём: экран, повисший на таймауте в 12 с, не должен
   *  останавливать прогрев навсегда. */
  maxWaitMs: number;
}

/** Дождаться тишины. `true` — дождались, `false` — вышел предел ожидания или
 *  прогрев остановили. */
export async function waitForQuiet(
  opts: Pick<
    WarmQueueOptions<unknown>,
    "isBusy" | "shouldStop" | "now" | "sleep" | "pollMs" | "settleMs" | "maxWaitMs"
  >,
): Promise<boolean> {
  const start = opts.now();
  let quietSince: number | null = null;
  for (;;) {
    if (opts.shouldStop()) return false;
    const t = opts.now();
    if (opts.isBusy()) {
      quietSince = null;
    } else {
      quietSince ??= t;
      if (t - quietSince >= opts.settleMs) return true;
    }
    if (t - start >= opts.maxWaitMs) return false;
    await opts.sleep(opts.pollMs);
  }
}

/** ПРОГРЕВ УСТУПАЕТ ЭКРАНУ. Бесплатный тариф ставит запросы в очередь: пачка
 *  из 20–40 делает каждый по 2–6 с, хотя сам SQL — 10–25 мс. Поэтому чтения
 *  идут по двое, в порядке списка, и каждое — только когда экран ничего не
 *  грузит (но не дольше `maxWaitMs`). */
export async function runWarmQueue<T>(
  items: readonly T[],
  work: (item: T) => Promise<void>,
  opts: WarmQueueOptions<T>,
): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      if (opts.shouldStop()) return;
      const item = items[next++] as T;
      if (!opts.needed(item)) continue;
      await waitForQuiet(opts);
      if (opts.shouldStop()) return;
      if (!opts.needed(item)) continue;
      await work(item);
    }
  };
  const workers = Math.max(1, Math.min(opts.concurrency, items.length));
  await Promise.all(Array.from({ length: workers }, worker));
}
