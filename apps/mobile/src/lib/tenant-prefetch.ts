import { AppState, InteractionManager } from "react-native";
import { hashKey, onlineManager } from "@tanstack/react-query";
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
import { listDebtPaidTotals, listDebts } from "@babun/shared/db/repositories/debts";
import type { CalendarSettings } from "@babun/shared/local/calendar-settings";
import {
  getCurrentCyprusTime,
  getCurrentTimeInZone,
} from "@babun/shared/common/utils/date-utils";
import { supabase } from "@/lib/supabase";
import { queryClient } from "@/lib/query-client";
import { getActiveTenantId, getActiveUserId } from "@/lib/active-tenant";
import { tenantBoundClient } from "@/lib/tenant-bound-client";
import {
  calendarSettingsQueryKey,
  currentRoleQueryKey,
} from "@/lib/company-query-keys";
import { keyNamesKnownTenant } from "@/lib/tenant-query-keys";
import {
  companiesToWarm,
  planCalendarWave,
  planFinanceWave,
  runWarmQueue,
  screensBusyFrom,
  waitForQuiet,
  type WarmCompany,
  type WarmJob,
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
} from "@/features/reference/queries";
import { fetchServices } from "@/features/services/queries";
import { pagingClient } from "@/features/calendar/queries";
import { listMasterAppointmentsSafePaged } from "@/features/calendar/master-appointments";
import { listMasterClientsSafe } from "@/features/clients/queries";
import { defaultPeriod } from "@/features/finances/period";

// ПРОГРЕВ КОМПАНИЙ — ЧТОБЫ ПЕРЕХОД БЫЛ ПЕРВЫМ КАДРОМ С ДАННЫМИ.
//
// Сам переход давно стоит 71 мс: компания меняется в памяти устройства, сеть
// не ждётся. Но экран за ним показывал «загрузку», потому что данных ТОЙ
// компании в памяти не было — react-query живёт в памяти, и после каждого
// запуска приложения любая компания, кроме активной, холодная. Владелец
// 2026-09-13: «чтобы заранее погружалось… открывается сразу же этот день,
// неделя… между своими и чужими командами без каких-либо задержек».
//
// Поэтому пока человек работает, приложение заранее читает первые экраны его
// компаний — каждой под её заголовком, привязанным клиентом (`bind-tenant.ts`)
// — и кладёт ответы в react-query ПОД ТЕМИ ЖЕ КЛЮЧАМИ, которые спросит экран
// (`tenant-prefetch-plan.ts`, ключи из `company-query-keys.ts`). Переход
// находит данные на месте; протухшие перечитываются в фоне, уже под открытым
// экраном.
//
// АКТИВНАЯ ТОЖЕ (2026-09-15). Раньше грелись только другие компании, и у
// активной холодными оставались экраны, которые ещё не открывали: мастера с
// архивом, карта графиков, деньги. Её ключи с побочными действиями хука
// прогрев не трогает (`ACTIVE_COMPANY_SKIPS`), а ключ, за которым уже следит
// экран, — тем более: свежесть там решает экран.
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
/** Таймер монтирования (`AppProviders.tsx`) больше не держит прогрев 1,5 с:
 *  старт — после взаимодействий (`InteractionManager`), а каждое чтение ещё и
 *  ждёт, пока экран дограузится (`screensBusy`). Фиксированная пауза была
 *  грубым заменителем этой проверки: то слишком рано для медленной сети, то
 *  зря для быстрой. */
export const FIRST_WARM_DELAY_MS = 0;
/** Повторный прогрев, пока приложение на переднем плане. Чаще не надо:
 *  лишние круги по другим компаниям — это та самая очередь бесплатного
 *  тарифа, из-за которой переход ждёт. */
export const REWARM_EVERY_MS = 10 * 60_000;
/** Возврат на передний план / сети чаще этого прогрев не повторяет. */
const FOREGROUND_DEBOUNCE_MS = 30_000;
const CONCURRENCY = 2;
const QUIET_POLL_MS = 50;
const QUIET_SETTLE_MS = 100;
/** Предел ожидания тишины перед одним чтением и перед стартом круга. */
const QUIET_MAX_WAIT_MS = 5_000;

type Client = typeof supabase;

interface CompanyContext {
  tenantId: string;
  role: UserRole;
  client: Client;
}

function companyContext({ tenantId, role }: WarmCompany): CompanyContext {
  return { tenantId, role, client: tenantBoundClient(tenantId) };
}

/** Чтение одной цели — ровно тем же путём, что и хук экрана, но клиентом,
 *  привязанным к компании, и без побочных действий. Исчерпывающий `switch`:
 *  новый вид цели без чтения не пройдёт проверку типов. */
function readTarget(ctx: CompanyContext, target: WarmTarget): Promise<unknown> {
  const { tenantId, role, client } = ctx;
  switch (target.kind) {
    case "tenant":
      return fetchTenantProfile(client, tenantId, role);
    case "calendar-settings":
      return fetchCalendarSettings(client, tenantId, role);
    case "teams-all":
      return fetchTeams(client, tenantId, role, true);
    case "appointments":
      return role === "master"
        ? listMasterAppointmentsSafePaged(client)
        : repoListAppointments(pagingClient(client), tenantId);
    case "services-all":
      return fetchServices(client, tenantId, role, { archived: true });
    case "cities":
      return fetchCities(client, tenantId, false, null);
    case "day-cities":
      return listDayCities(client, tenantId);
    case "team-schedules-all":
      return listScheduleEntries(client, tenantId);
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
    // Долги — всей компанией, без `teamId`: хук читает тот же срез и отбирает
    // команду на устройстве (`pickTeamDebts`), так что один прогретый ответ
    // годится для любого чипа.
    case "debts":
      return listDebts(client, tenantId, target.from as string, target.to as string);
    case "debt-paid-totals":
      return listDebtPaidTotals(client, tenantId);
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

/** Хеши ключей, которые сейчас читает сам прогрев. Своё чтение не считается
 *  «экран занят» — иначе второй рабочий ждал бы первого, и по двое не вышло
 *  бы никогда. */
const warmingHashes = new Set<string>();

/** Экран что-то грузит или пишет. Пишет — тоже повод подождать: ответ
 *  прогрева, приземлившийся между оптимистичной правкой и её сохранением,
 *  вернул бы на экран старое значение. */
function screensBusy(): boolean {
  // Правило — листом (`screensBusyFrom`, с тестом). «В полёте» — ровно то,
  // что считает `isFetching`: запросы со статусом загрузки `fetching`.
  return screensBusyFrom({
    fetchingHashes: queryClient
      .getQueryCache()
      .findAll({ fetchStatus: "fetching" })
      .map((query) => query.queryHash),
    warmingHashes,
    mutating: queryClient.isMutating(),
  });
}

/** Нужно ли греть ключ. Не нужно, если за ним уже следит экран (свежесть там
 *  решает хук), если он уже в полёте и если данные есть и моложе
 *  `WARM_STALE_MS`. Пометка «протух» от перехода не считается: её снимет
 *  экран, когда откроется. */
function needsWarm(queryKey: readonly unknown[]): boolean {
  const query = queryClient.getQueryCache().find({ queryKey, exact: true });
  if (!query) return true;
  if (query.getObserversCount() > 0) return false;
  if (query.state.fetchStatus === "fetching") return false;
  return !(
    query.state.data !== undefined &&
    Date.now() - query.state.dataUpdatedAt < WARM_STALE_MS
  );
}

/** Прогреть одну цель. `prefetchQuery` ошибок наружу не отдаёт — цель,
 *  которую не удалось прочитать, просто останется холодной. */
async function warmTarget(ctx: CompanyContext, target: WarmTarget): Promise<void> {
  const hash = hashKey(target.queryKey);
  warmingHashes.add(hash);
  try {
    await queryClient.prefetchQuery({
      queryKey: target.queryKey,
      queryFn: () => readTarget(ctx, target),
      staleTime: WARM_STALE_MS,
      retry: 1,
    });
  } finally {
    warmingHashes.delete(hash);
  }
}

/** Период финансов «по умолчанию» — так же, как его считает экран финансов:
 *  текущий месяц в часовом поясе компании, без пояса — кипрское время.
 *  Настроек в кэше нет (первая волна их не дочитала) — деньги этой компании
 *  не греем: месяц не в том поясе грел бы чужой срез. */
function financePeriodOf(
  company: WarmCompany,
): { from: string; to: string } | null {
  const settings = queryClient.getQueryData<CalendarSettings>(
    calendarSettingsQueryKey(company.tenantId, company.role),
  );
  if (!settings) return null;
  const now = settings.timezone
    ? getCurrentTimeInZone(settings.timezone)
    : getCurrentCyprusTime();
  const { from, to } = defaultPeriod(now);
  return { from, to };
}

/** Компании человека с ролью в каждой. Лента читается ОБЫЧНЫМ клиентом: флаг
 *  «активная» в ней считается от заголовка (см. `fetchMyCalendars`). Роль,
 *  которой продукт не знает, не греем: экран сам спросит сервер. */
async function knownCompanies(
  userId: string,
): Promise<{ tenantId: string; role: UserRole }[]> {
  const calendars = await queryClient.fetchQuery<MyCalendar[]>({
    queryKey: [...myCalendarsQueryKey, userId],
    queryFn: () => fetchMyCalendars(supabase),
    staleTime: 60_000,
  });
  const known: { tenantId: string; role: UserRole }[] = [];
  for (const calendar of calendars) {
    if (isUserRole(calendar.role)) {
      known.push({ tenantId: calendar.tenantId, role: calendar.role });
    }
  }
  return known;
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

/** Уволенную компанию прогрев забывает сразу. Данные стирает
 *  `lib/evict-company.ts`; здесь — только память о том, что компанию грели. */
export function forgetWarmCompany(tenantId: string): void {
  rememberedTenants?.delete(tenantId);
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

async function runOnce(): Promise<void> {
  const userId = getActiveUserId();
  const activeTenantId = getActiveTenantId();
  if (!userId || !activeTenantId) return;
  // Компания устройства сменилась, пока грели, — цель ушла из-под ног: круг
  // обрывается, следующий начнётся уже от новой активной. Чтение, начатое до
  // смены, приземлится под ключ СВОЕЙ компании: клиент привязан к ней.
  const moved = () => getActiveTenantId() !== activeTenantId;
  const quiet = {
    isBusy: screensBusy,
    shouldStop: moved,
    now: () => Date.now(),
    sleep,
    pollMs: QUIET_POLL_MS,
    settleMs: QUIET_SETTLE_MS,
    maxWaitMs: QUIET_MAX_WAIT_MS,
  };

  // Лента — тоже запрос; после перехода она перечитывается сама, и прогрев
  // встаёт за ней, а не рядом.
  await waitForQuiet(quiet);
  if (moved()) return;
  const known = await knownCompanies(userId);
  if (moved()) return;
  const activeRole = queryClient.getQueryData<UserRole | null>(
    currentRoleQueryKey(activeTenantId),
  );
  const companies = companiesToWarm({
    calendars: known,
    activeTenantId,
    activeRole: isUserRole(activeRole) ? activeRole : null,
  });
  dropRevokedCompanies(
    new Set([activeTenantId, ...companies.map((c) => c.tenantId)]),
  );

  // Роль другой компании — из ленты (та же строка членства, что читает
  // `current_user_role`). Без неё каждый хук компании выключен, и граница
  // прав показывает крутилку, пока роль летит на сервер. Уже известную не
  // трогаем: у неё свой опрос раз в минуту. Роль активной — забота её опроса.
  for (const company of companies) {
    if (company.active) continue;
    const roleKey = currentRoleQueryKey(company.tenantId);
    if (queryClient.getQueryData(roleKey) === undefined) {
      queryClient.setQueryData(roleKey, company.role);
    }
  }

  const contexts = new Map(
    companies.map((company) => [company.tenantId, companyContext(company)]),
  );
  const warmJob = (job: WarmJob) =>
    warmTarget(contexts.get(job.tenantId) as CompanyContext, job.target);
  const queue = {
    ...quiet,
    concurrency: CONCURRENCY,
    needed: (job: WarmJob) => needsWarm(job.target.queryKey),
  };

  const startedAt = Date.now();
  const calendarWave = planCalendarWave(companies);
  await runWarmQueue(calendarWave, warmJob, queue);
  if (moved()) return;
  const financeWave = planFinanceWave(
    companies.map((company) => ({
      ...company,
      canViewFinances: can(company.role, "view-finances"),
      period: financePeriodOf(company),
    })),
  );
  await runWarmQueue(financeWave, warmJob, queue);
  if (__DEV__) {
    console.log(
      `[прогрев] компаний ${companies.length}: календарь ${calendarWave.length}, деньги ${financeWave.length} ключей за ${Date.now() - startedAt} мс`,
    );
  }
}

/** Круг прогрева стартует после взаимодействий: анимация перехода и первый
 *  кадр важнее. Но не ждём вечно — утёкшая ручка взаимодействия какой-нибудь
 *  библиотеки иначе навсегда заперла бы прогрев на весь сеанс. */
function afterInteractions(): Promise<void> {
  return new Promise<void>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const task = InteractionManager.runAfterInteractions(() => {
      clearTimeout(timer);
      resolve();
    });
    timer = setTimeout(() => {
      task.cancel();
      resolve();
    }, QUIET_MAX_WAIT_MS);
  });
}

let inFlight: Promise<void> | null = null;
let rerunRequested = false;
let lastFinishedAt = 0;

/** Прогреть компании человека — активную и все другие. Имя прежнее: так его
 *  зовёт монтирование в `AppProviders.tsx`. Одновременно идёт не больше
 *  одного прогрева; просьба во время идущего — ещё один круг после него.
 *  Наружу не бросает. */
export function warmOtherCompanies(): Promise<void> {
  if (inFlight) {
    rerunRequested = true;
    return inFlight;
  }
  inFlight = (async () => {
    try {
      do {
        rerunRequested = false;
        await afterInteractions();
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
