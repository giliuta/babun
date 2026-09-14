import { AppState } from "react-native";
import { onlineManager } from "@tanstack/react-query";
import {
  listAppointments as repoListAppointments,
} from "@babun/shared/db/repositories/appointments";
import {
  listClientTags as repoListClientTags,
  listClients as repoListClients,
} from "@babun/shared/db/repositories/clients";
import { listScheduleEntries } from "@babun/shared/db/repositories/schedule";
import { listDayExtras } from "@babun/shared/db/repositories/day-extras";
import { listDayCities } from "@babun/shared/db/repositories/day-cities";
import {
  listAccountBalances,
  listRefundTotals,
  listTransactionsForRange,
} from "@babun/shared/db/repositories/finance-transactions";
import { listFinanceCategories } from "@babun/shared/db/repositories/finance-categories";
import { listAccounts } from "@babun/shared/db/repositories/accounts";
import { listInvoices } from "@babun/shared/db/repositories/invoices";
import { listInvoicePayments } from "@babun/shared/db/repositories/invoice-payments";
import type { ScheduleMap } from "@babun/shared/local/schedule";
import type { CalendarSettings } from "@babun/shared/local/calendar-settings";
import {
  getCurrentCyprusTime,
  getCurrentTimeInZone,
} from "@babun/shared/common/utils/date-utils";
import { supabase } from "@/lib/supabase";
import { queryClient } from "@/lib/query-client";
import { getActiveTenantId, getActiveUserId } from "@/lib/active-tenant";
import { tenantBoundClient } from "@/lib/tenant-bound-client";
import { currentRoleQueryKey } from "@/lib/company-query-keys";
import { keyNamesKnownTenant } from "@/lib/tenant-query-keys";
import {
  planCompanyGate,
  planCompanyWarm,
  type WarmTarget,
} from "@/lib/tenant-prefetch-plan";
import {
  fetchMyCalendars,
  myCalendarsQueryKey,
  type MyCalendar,
} from "@/features/settings/workspaces";
import { can, isUserRole, type UserRole } from "@/features/settings/role-policy";
import {
  fetchCalendarSettings,
  fetchTenantProfile,
} from "@/features/settings/company-fetchers";
import {
  fetchCities,
  fetchMasters,
  fetchTeams,
  type Team,
} from "@/features/reference/queries";
import { fetchServices } from "@/features/services/queries";
import { pagingClient } from "@/features/calendar/queries";
import { listMasterAppointmentsSafePaged } from "@/features/calendar/master-appointments";
import { listMasterClientsSafe } from "@/features/clients/queries";
import { defaultPeriod } from "@/features/finances/period";

// ПРОГРЕВ ДРУГИХ КОМПАНИЙ — ЧТОБЫ ПЕРЕХОД БЫЛ ПЕРВЫМ КАДРОМ С ДАННЫМИ.
//
// Сам переход давно стоит 71 мс: компания меняется в памяти устройства, сеть
// не ждётся. Но экран за ним показывал «загрузку», потому что данных ТОЙ
// компании в памяти не было — react-query живёт в памяти, и после каждого
// запуска приложения любая компания, кроме активной, холодная. Владелец
// 2026-09-13: «чтобы заранее погружалось… открывается сразу же этот день,
// неделя… между своими и чужими командами без каких-либо задержек».
//
// Поэтому пока человек работает в компании A, приложение заранее читает
// первый экран каждой другой его компании — под её заголовком, привязанным
// клиентом (`bind-tenant.ts`) — и кладёт ответы в react-query ПОД ТЕМИ ЖЕ
// КЛЮЧАМИ, которые спросит экран (`tenant-prefetch-plan.ts`, ключи из
// `company-query-keys.ts`). Переход находит данные на месте; протухшие
// перечитываются в фоне, уже под открытым экраном.
//
// ТОЛЬКО В ПАМЯТЬ, И ЭТО ПРОВЕРЯЕТ СТОРОЖ (`tenant-prefetch.test.ts`). Прогрев
// не пишет SQLite-кэш (`cacheReplaceTenant`), не будит выгрузку очереди
// (`kickReplayer`), не эмитит `revalidated`, не ставит валюту форматтеров и
// не пишет MMKV: всё это — свойства АКТИВНОЙ компании, и сделанное от имени
// другой протекло бы на её экран. Записи и клиенты читаются напрямую из
// репозиториев, минуя офлайн-обёртки, ровно по этой причине.
//
// Что греется — решает право чтения на сервере: под заголовком B политики
// отдают то, что человеку в B положено. Владельцу — всё, мастеру — его
// проекции через безопасные функции. Больше, чем он и так увидит, открыв B,
// на телефон не приезжает.

/** Данные моложе этого — тёплые, перечитывать их прогрев не станет. Переход
 *  пометил их протухшими? Неважно: перечитает экран, когда его откроют. */
const WARM_STALE_MS = 10 * 60_000;
/** Первый прогрев после входа/перехода — с отступом, чтобы не толкаться в
 *  сети с первым кадром активной компании. */
export const FIRST_WARM_DELAY_MS = 1_500;
/** Повторный прогрев, пока приложение на переднем плане. */
export const REWARM_EVERY_MS = 10 * 60_000;
/** Возврат на передний план / сети чаще этого прогрев не повторяет. */
const FOREGROUND_DEBOUNCE_MS = 30_000;
const CONCURRENCY = 3;

type Client = typeof supabase;

interface CompanyContext {
  tenantId: string;
  role: UserRole;
  client: Client;
  /** Карта расписаний одна на компанию: ключей по команде несколько, а RPC —
   *  один. */
  schedules?: Promise<ScheduleMap>;
}

function schedulesOf(ctx: CompanyContext): Promise<ScheduleMap> {
  ctx.schedules ??= listScheduleEntries(ctx.client, ctx.tenantId);
  return ctx.schedules;
}

/** Чтение одной цели — ровно тем же путём, что и хук экрана, но клиентом
 *  чужой компании и без побочных действий. Исчерпывающий `switch`: новый вид
 *  цели без чтения не пройдёт проверку типов. */
function readTarget(ctx: CompanyContext, target: WarmTarget): Promise<unknown> {
  const { tenantId, role, client } = ctx;
  switch (target.kind) {
    case "tenant":
      return fetchTenantProfile(client, tenantId, role);
    case "calendar-settings":
      return fetchCalendarSettings(client, tenantId, role);
    case "teams":
      return fetchTeams(client, tenantId, role, false);
    case "teams-all":
      return fetchTeams(client, tenantId, role, true);
    case "appointments":
      return role === "master"
        ? listMasterAppointmentsSafePaged(client)
        : repoListAppointments(pagingClient(client), tenantId);
    case "services":
      return fetchServices(client, tenantId, role, { archived: false });
    case "services-all":
      return fetchServices(client, tenantId, role, { archived: true });
    case "cities":
      return fetchCities(client, tenantId, false, target.teamId ?? null);
    case "day-cities":
      return listDayCities(client, tenantId);
    case "team-schedule":
      return schedulesOf(ctx).then(
        (map) => map[target.teamId as string] ?? null,
      );
    case "team-schedules-all":
      return schedulesOf(ctx);
    case "day-extras":
      return listDayExtras(client, tenantId);
    case "clients":
      return role === "master"
        ? listMasterClientsSafe(client)
        : repoListClients(client, tenantId);
    case "client-tags":
      return role === "master"
        ? Promise.resolve([])
        : repoListClientTags(client, tenantId);
    case "masters":
      return fetchMasters(client, tenantId, role, false);
    case "masters-all":
      return fetchMasters(client, tenantId, role, true);
    case "finance-categories":
      return listFinanceCategories(client, tenantId);
    case "transactions":
      return listTransactionsForRange(
        client,
        tenantId,
        target.from as string,
        target.to as string,
      );
    case "refund-totals":
      return listRefundTotals(client, tenantId);
    case "invoices":
      return listInvoices(client, tenantId, {});
    case "invoice-payments":
      return listInvoicePayments(client, tenantId);
    case "account-rows":
      return listAccounts(client, tenantId, { includeInactive: false });
    case "account-balances":
      return listAccountBalances(client, tenantId);
    default: {
      const unreachable: never = target.kind;
      throw new Error(`Прогрев не знает цели «${String(unreachable)}»`);
    }
  }
}

/** Тёплый — значит данные есть и они моложе `WARM_STALE_MS`. Пометка
 *  «протух» от перехода не считается: её снимет экран, когда откроется. */
function isWarm(queryKey: readonly unknown[]): boolean {
  const query = queryClient.getQueryCache().find({ queryKey, exact: true });
  const state = query?.state;
  return (
    state?.data !== undefined &&
    Date.now() - state.dataUpdatedAt < WARM_STALE_MS
  );
}

/** Прогреть одну цель. `prefetchQuery` ошибок наружу не отдаёт — цель,
 *  которую не удалось прочитать, просто останется холодной. */
async function warmTarget(ctx: CompanyContext, target: WarmTarget): Promise<void> {
  if (isWarm(target.queryKey)) return;
  await queryClient.prefetchQuery({
    queryKey: target.queryKey,
    queryFn: () => readTarget(ctx, target),
    staleTime: WARM_STALE_MS,
    retry: 1,
  });
}

/** Прочитать цель и вернуть данные — для первой волны, из которой
 *  собирается вторая. */
function fetchTarget<T>(ctx: CompanyContext, target: WarmTarget): Promise<T> {
  return queryClient.fetchQuery({
    queryKey: target.queryKey,
    queryFn: () => readTarget(ctx, target) as Promise<T>,
    staleTime: WARM_STALE_MS,
    retry: 1,
  });
}

async function runPool(
  targets: readonly WarmTarget[],
  work: (target: WarmTarget) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < targets.length) {
      const target = targets[next++] as WarmTarget;
      await work(target);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}

/** Период финансов «по умолчанию» — так же, как его считает экран финансов:
 *  текущий месяц в часовом поясе компании, без пояса — кипрское время. */
function defaultFinancePeriod(settings: CalendarSettings): {
  from: string;
  to: string;
} {
  const now = settings.timezone
    ? getCurrentTimeInZone(settings.timezone)
    : getCurrentCyprusTime();
  const { from, to } = defaultPeriod(now);
  return { from, to };
}

async function warmCompany(tenantId: string, role: UserRole): Promise<number> {
  const ctx: CompanyContext = {
    tenantId,
    role,
    client: tenantBoundClient(tenantId),
  };

  // Роль — из ленты календарей (та же строка членства, что читает
  // `current_user_role`). Без неё каждый хук компании выключен, и граница
  // прав показывает крутилку, пока роль летит на сервер. Уже известную не
  // трогаем: у неё свой опрос раз в минуту.
  const roleKey = currentRoleQueryKey(tenantId);
  if (queryClient.getQueryData(roleKey) === undefined) {
    queryClient.setQueryData(roleKey, role);
  }

  const [gateTenant, gateSettings, gateTeams, gateTeamsAll] =
    planCompanyGate({ tenantId, role });
  const [settings, , teamsAll] = await Promise.all([
    fetchTarget<CalendarSettings>(ctx, gateSettings as WarmTarget),
    fetchTarget<Team[]>(ctx, gateTeams as WarmTarget),
    fetchTarget<Team[]>(ctx, gateTeamsAll as WarmTarget),
    warmTarget(ctx, gateTenant as WarmTarget),
  ]);

  const targets = planCompanyWarm({
    tenantId,
    role,
    teamIds: teamsAll.map((team) => team.id),
    period: defaultFinancePeriod(settings),
    canViewFinances: can(role, "view-finances"),
  });
  await runPool(targets, (target) => warmTarget(ctx, target));
  return 4 + targets.length;
}

/** Компании человека, кроме активной, — по одной записи на компанию с ролью
 *  в ней. Лента читается ОБЫЧНЫМ клиентом: флаг «активная» в ней считается
 *  от заголовка (см. `fetchMyCalendars`). */
async function otherCompanies(
  userId: string,
  activeTenantId: string,
): Promise<{ tenantId: string; role: UserRole }[]> {
  const calendars = await queryClient.fetchQuery<MyCalendar[]>({
    queryKey: [...myCalendarsQueryKey, userId],
    queryFn: () => fetchMyCalendars(supabase),
    staleTime: 60_000,
  });
  const byTenant = new Map<string, UserRole>();
  for (const calendar of calendars) {
    if (calendar.tenantId === activeTenantId) continue;
    if (byTenant.has(calendar.tenantId)) continue;
    // Роль, которой продукт не знает, не греем: экран сам спросит сервер.
    if (isUserRole(calendar.role)) byTenant.set(calendar.tenantId, calendar.role);
  }
  return [...byTenant].map(([tenantId, role]) => ({ tenantId, role }));
}

/** Компании, которые устройство считало своими в прошлый прогрев. Пропала из
 *  ленты — значит человека из неё исключили: её данные уходят из памяти
 *  ЗДЕСЬ, не дожидаясь перехода. (Активную компанию сносить нельзя — её экран
 *  открыт; отзыв там встречает опрос роли.) */
let rememberedTenants: Set<string> | null = null;

function dropRevokedCompanies(current: Set<string>): void {
  if (rememberedTenants) {
    const gone = [...rememberedTenants].filter((id) => !current.has(id));
    if (gone.length > 0) {
      queryClient.removeQueries({
        predicate: (query) => keyNamesKnownTenant(query.queryKey, gone),
      });
    }
  }
  rememberedTenants = current;
}

async function runOnce(): Promise<void> {
  const userId = getActiveUserId();
  const activeTenantId = getActiveTenantId();
  if (!userId || !activeTenantId) return;

  const companies = await otherCompanies(userId, activeTenantId);
  dropRevokedCompanies(
    new Set([activeTenantId, ...companies.map((c) => c.tenantId)]),
  );

  for (const company of companies) {
    // Компания устройства сменилась, пока грели, — цель ушла из-под ног:
    // дальше греть её экраном, а не прогревом.
    if (getActiveTenantId() !== activeTenantId) return;
    const startedAt = Date.now();
    const count = await warmCompany(company.tenantId, company.role);
    if (__DEV__) {
      console.log(
        `[прогрев] ${company.tenantId.slice(0, 8)} (${company.role}): ${count} ключей за ${Date.now() - startedAt} мс`,
      );
    }
  }
}

let inFlight: Promise<void> | null = null;
let rerunRequested = false;
let lastFinishedAt = 0;

/** Прогреть все другие компании. Одновременно идёт не больше одного прогрева;
 *  просьба во время идущего — ещё один круг после него. Наружу не бросает. */
export function warmOtherCompanies(): Promise<void> {
  if (inFlight) {
    rerunRequested = true;
    return inFlight;
  }
  inFlight = (async () => {
    try {
      do {
        rerunRequested = false;
        await runOnce().catch(() => {
          // Сети нет или лента не прочиталась — прогрев вернётся со следующим
          // поводом: передний план, сеть, таймер.
        });
      } while (rerunRequested);
    } finally {
      inFlight = null;
      lastFinishedAt = Date.now();
    }
  })();
  return inFlight;
}

/** Повод «сеть/передний план вернулись»: чаще раза в полминуты не греем. */
function warmIfQuiet(): void {
  if (Date.now() - lastFinishedAt < FOREGROUND_DEBOUNCE_MS) return;
  void warmOtherCompanies();
}

// ТОЧКИ, ГДЕ СЕТЬ ЗАВЕДОМО ВЕРНУЛАСЬ — как у догона claim'а
// (`claim-catch-up.ts`). Подписки живут столько же, сколько приложение.
AppState.addEventListener("change", (state) => {
  if (state === "active") warmIfQuiet();
});
onlineManager.subscribe((online) => {
  if (online) warmIfQuiet();
});
