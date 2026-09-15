import { keyNamesKnownTenant } from "./tenant-query-keys";

// ТИХОЕ ДООБНОВЛЕНИЕ ПОСЛЕ ПЕРЕХОДА — ПРАВИЛА ЛИСТОМ БЕЗ ЗАВИСИМОСТЕЙ.
//
// Владелец 2026-09-15: «когда переключаюсь между командами, всё равно
// загружается с задержкой; так быть не должно». Замер показал не медленный
// SQL (10–25 мс на запрос), а ОЧЕРЕДЬ бесплатного плана Supabase: переход
// помечал протухшим весь кэш, каждый смонтированный экран шёл в сеть разом, и
// 17–20 запросов стояли в очереди по 3–5 с каждый.
//
// Отсюда три правила, и все они про ВОЗРАСТ ДАННЫХ, а не про часы:
//   • ключ компании свежий, пока данные моложе порога. Порог короткий
//     (`ACTIVE_FRESH_MS`) у компании, в которой человек уже работает, и
//     длинный (`WARM_STALE_MS`) у той, куда он только что перешёл, — пока её
//     дообновление не закончилось, — и у остальных его компаний;
//   • после перехода запросы новой компании старше минуты перечитываются
//     ФОНОМ, по два за раз и в порядке важности, и очередь сама себя
//     останавливает, если компания снова сменилась;
//   • фоновые работы (догон claim'а, опрос роли) ждут, пока очередь стихнет.
//
// ГЛОБАЛЬНОГО «ОКНА ТИШИНЫ» ЗДЕСЬ НЕТ НАМЕРЕННО. Окно по часам отдаёт любые
// данные, хоть суточные, и если оно однажды не закроется — не обновится
// ничего и никогда. Здесь длинный порог держится ровно столько, сколько живёт
// очередь конкретной компании, и даже в это время данные старше десяти минут
// перечитываются сразу.
//
// Лист без react-native: правила проверяются тестом, а не чтением глазами.

/** Порог свежести ключей компании, в которой человек уже работает. */
export const ACTIVE_FRESH_MS = 60_000;

/** Порог свежести тёплых данных — ОБЯЗАН совпадать с `WARM_STALE_MS` прогрева
 *  (`tenant-prefetch.ts`): разойдись они, прогрев считал бы тёплым то, что
 *  экран после перехода перечитает сам. Совпадение держит тест. */
export const WARM_STALE_MS = 10 * 60_000;

/** Прежний общий `staleTime` — для ключей, которые компанию не называют. */
export const DEFAULT_STALE_MS = 30_000;

/** Очередь стартует не сразу: первый кадр новой компании рисуется из кэша, и
 *  толкаться с ним в сети незачем. */
export const SWITCH_REVALIDATE_DELAY_MS = 2_000;

/** Два запроса за раз — больше бесплатный план в очереди не держит без
 *  ожидания. Поднимать нельзя: именно очередь сервера и была задержкой. */
export const SWITCH_REVALIDATE_CONCURRENCY = 2;

/** Сколько очередь ждёт одно чтение. supabase-js на RN без таймаута: один
 *  повисший запрос иначе держал бы и очередь, и всех, кто ждёт её тишины. Сам
 *  запрос не отменяется — очередь просто идёт дальше. */
export const REVALIDATE_JOB_CAP_MS = 12_000;

/** Догон claim'а (`activate_tenant` + `refreshSession`) — не раньше этого
 *  после перехода: две поездки в самой гуще очереди стоили бы секунд первому
 *  кадру. */
export const CLAIM_FIRST_ATTEMPT_DELAY_MS = 3_000;

/** Порядок важности: первой — роль (единственная сверка «всё ещё участник»,
 *  пока опрос роли стоит; разбор у `planSwitchRevalidation`), затем то, из
 *  чего рисуется календарь. Остальное — в том порядке, в каком лежит в кэше. */
export const REVALIDATION_PRIORITY: readonly string[] = [
  "current-role",
  "appointments",
  "teams",
  "calendar-settings",
  "tenant",
];

// ---------------------------------------------------------------------------
// Фаза дообновления: одна на устройство, потому что активная компания одна.

interface RevalidationPhase {
  tenantId: string;
  generation: number;
  /** false — очередь запланирована, но ещё не стартовала. */
  running: boolean;
}

let phase: RevalidationPhase | null = null;
let generationCounter = 0;
let knownTenants: readonly string[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of [...listeners]) listener();
}

export function subscribeSwitchRevalidation(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Переход начался: компания `tenantId` дообновляется очередью. Возвращает
 *  поколение — по нему поздний таймер прежнего перехода узнаёт, что он уже не
 *  хозяин. */
export function beginRevalidationPhase(
  tenantId: string,
  knownTenantIds: readonly string[],
): number {
  generationCounter += 1;
  phase = { tenantId, generation: generationCounter, running: false };
  knownTenants = [...new Set([...knownTenantIds, tenantId])];
  emit();
  return generationCounter;
}

export function isCurrentRevalidation(generation: number): boolean {
  return phase?.generation === generation;
}

export function markRevalidationRunning(generation: number): boolean {
  if (!phase || phase.generation !== generation) return false;
  phase = { ...phase, running: true };
  emit();
  return true;
}

/** Закрывает фазу, только если она всё ещё своя: быстрый круг A → B → A не
 *  имеет права погасить фазу A поздним окончанием очереди B. */
export function endRevalidationPhase(generation: number): void {
  if (!phase || phase.generation !== generation) return;
  phase = null;
  emit();
}

/** Переход не состоялся — длинный порог компании, куда не перешли, снимается. */
export function abandonRevalidationPhase(tenantId: string): void {
  if (!phase || phase.tenantId !== tenantId) return;
  phase = null;
  emit();
}

/** Компания, чьи ключи сейчас под длинным порогом, потому что их дообновит
 *  очередь. */
export function deferredTenantId(): string | null {
  return phase?.tenantId ?? null;
}

/** Очередь сейчас читает сеть. Полоса загрузки в это время не показывается:
 *  человек ничего не ждёт, экран уже нарисован. */
export function isSilentRevalidating(): boolean {
  return phase?.running === true;
}

export function isRevalidationIdle(): boolean {
  return phase === null;
}

/** Компании человека, названные последним переходом. */
export function knownTenantIds(): readonly string[] {
  return knownTenants;
}

export function whenRevalidationIdle(): Promise<void> {
  if (!phase) return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = subscribeSwitchRevalidation(() => {
      if (phase) return;
      unsubscribe();
      resolve();
    });
  });
}

/** Только для тестов: состояние модуля живёт между тестами одного файла. */
export function resetSwitchRevalidationForTests(): void {
  phase = null;
  knownTenants = [];
  listeners.clear();
}

// ---------------------------------------------------------------------------
// Свежесть ключей.

export interface FreshnessContext {
  activeTenantId: string | null;
  deferredTenantId: string | null;
  knownTenantIds: readonly string[];
}

/** Сколько данные ключа считаются свежими. `null` — ключ компанию не называет,
 *  и решает прежний общий порог. */
export function companyFreshnessMs(
  key: readonly unknown[],
  ctx: FreshnessContext,
): number | null {
  if (ctx.deferredTenantId && keyNamesKnownTenant(key, [ctx.deferredTenantId])) {
    return WARM_STALE_MS;
  }
  if (ctx.activeTenantId && keyNamesKnownTenant(key, [ctx.activeTenantId])) {
    return ACTIVE_FRESH_MS;
  }
  // Ключ другой компании человека. Наблюдателей у него нет, но если экран
  // прежней компании успеет смонтироваться в кадре перехода, его запрос ушёл
  // бы уже с НОВЫМ заголовком — ровно гонка потери данных из `auth-clear.ts`.
  if (keyNamesKnownTenant(key, ctx.knownTenantIds)) return WARM_STALE_MS;
  return null;
}

/** `staleTime` по умолчанию. Функцией, а не числом, и это не вкус: экран
 *  календаря переход НЕ размонтирует — у его запросов меняется ключ, а на
 *  смене ключа react-query смотрит только на `staleTime`
 *  (`shouldFetchOptionally`), `refetchOnMount` там не спрашивается вовсе. */
export function staleTimeFor(
  key: readonly unknown[],
  ctx: FreshnessContext,
): number {
  return companyFreshnessMs(key, ctx) ?? DEFAULT_STALE_MS;
}

export interface QueryStateLike {
  data: unknown;
  dataUpdatedAt: number;
  isInvalidated: boolean;
}

/** `refetchOnMount` по умолчанию — для экранов, у которых свой `staleTime`
 *  короче порога компании (`staleTime: 0` и подобные).
 *
 *  Данных нет — читать. Данные ЯВНО протухли (правка, realtime) — читать: иначе
 *  возврат на экран после своей же правки показал бы старое. Ключ компании,
 *  которую дообновляет очередь, или другой компании человека, и данные моложе
 *  `WARM_STALE_MS` — не читать: это сделает очередь. Всё прочее решает
 *  `staleTime` запроса, как и раньше. */
export function refetchOnMountPolicy(
  state: QueryStateLike,
  key: readonly unknown[],
  ctx: FreshnessContext,
  now: number,
): boolean {
  if (state.data === undefined) return true;
  if (state.isInvalidated) return true;
  if (companyFreshnessMs(key, ctx) !== WARM_STALE_MS) return true;
  return now - state.dataUpdatedAt >= WARM_STALE_MS;
}

// ---------------------------------------------------------------------------
// Очередь дообновления.

export interface RevalidationCandidate {
  queryKey: readonly unknown[];
  queryHash: string;
  hasData: boolean;
  dataUpdatedAt: number;
  isInvalidated: boolean;
  /** Есть включённый наблюдатель — то есть это кто-то сейчас рисует. */
  active: boolean;
  fetching: boolean;
}

/** Что перечитать после перехода в `tenantId` и в каком порядке.
 *
 *  Только ключи НОВОЙ компании: запрос прежней ушёл бы с новым заголовком.
 *  Только те, что кто-то рисует: остальные перечитает экран, когда откроется.
 *  Без данных и уже летящие не трогаем — их и так грузит экран. */
export function planSwitchRevalidation(
  candidates: readonly RevalidationCandidate[],
  tenantId: string,
  now: number,
  skip: ReadonlySet<string> = new Set(),
): RevalidationCandidate[] {
  const rank = (candidate: RevalidationCandidate): number => {
    const head = candidate.queryKey[0];
    const index =
      typeof head === "string" ? REVALIDATION_PRIORITY.indexOf(head) : -1;
    return index === -1 ? REVALIDATION_PRIORITY.length : index;
  };
  return candidates
    .filter(
      (candidate) =>
        !skip.has(candidate.queryHash) &&
        candidate.active &&
        candidate.hasData &&
        !candidate.fetching &&
        keyNamesKnownTenant(candidate.queryKey, [tenantId]) &&
        // РОЛЬ — ВСЕГДА, КАКОЙ БЫ СВЕЖЕЙ ОНА НИ КАЗАЛАСЬ. Переход кладёт её из
        // ленты компаний прямо перед сменой, и её дата — это минута перехода,
        // а не минута ответа сервера: лента могла лежать часами. Опрос роли всю
        // очередь стоит (`rolePollInterval`), монтирование под длинным порогом
        // в сеть не идёт — и это чтение остаётся единственной сверкой «всё ещё
        // участник». Только ответ `null` и запускает `evictCompanyFromDevice`:
        // без него снятый участник смотрел бы кэш компании всю очередь и ещё
        // минуту опроса. Один раз за фазу — `skip` помнит перечитанное.
        (candidate.isInvalidated ||
          candidate.queryKey[0] === "current-role" ||
          now - candidate.dataUpdatedAt >= ACTIVE_FRESH_MS),
    )
    .map((candidate, order) => ({ candidate, order }))
    .sort((a, b) => rank(a.candidate) - rank(b.candidate) || a.order - b.order)
    .map(({ candidate }) => candidate);
}

/** Пул из `concurrency` работников. Перед КАЖДЫМ чтением спрашивает
 *  `shouldContinue`: компания сменилась — оставшееся не начинается. Упавшее
 *  чтение очередь не останавливает. Возвращает число начатых работ. */
export async function runRevalidationQueue<T>(opts: {
  jobs: readonly T[];
  concurrency: number;
  shouldContinue: () => boolean;
  run: (job: T) => Promise<void>;
}): Promise<number> {
  let next = 0;
  let started = 0;
  const worker = async (): Promise<void> => {
    while (next < opts.jobs.length) {
      if (!opts.shouldContinue()) return;
      const job = opts.jobs[next++] as T;
      started += 1;
      try {
        await opts.run(job);
      } catch {
        // Одна неудача — не повод бросать остальные ключи холодными.
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, opts.concurrency) }, worker),
  );
  return started;
}

/** Ждать работу, но не дольше `ms`. Сама работа не отменяется. */
export function withTimeCap(work: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work.then(
      () => undefined,
      () => undefined,
    ),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Сколько очередь одного перехода живёт всего. Не число проходов: экран,
 *  открытый во время ПОСЛЕДНЕГО прохода, получал длинный порог фазы, на
 *  монтировании в сеть не шёл (`refetchOnMountPolicy`) — и фаза закрывалась,
 *  так его и не перечитав. После закрытия порог снова короткий, но смена
 *  `staleTime` смонтированный экран не перечитывает: данные до десяти минут. */
export const REVALIDATE_BUDGET_MS = 45_000;

/** Проходы очереди — пока очередной план не окажется ПУСТЫМ.
 *
 *  Пустой план — единственный честный конец: фаза закрывается синхронно сразу
 *  за ним, и между «план пуст» и «порог снова короткий» не встанет ни одно
 *  монтирование. Бюджет вышел — последний план не ждём: его чтения уходят
 *  разом, и фаза закрывается. `refetchQueries` стартует запрос синхронно,
 *  поэтому они уходят ещё под этой компанией. */
export async function revalidateUntilSettled<T>(opts: {
  plan: () => T[];
  runQueue: (jobs: T[]) => Promise<unknown>;
  fireAndForget: (job: T) => void;
  shouldContinue: () => boolean;
  now: () => number;
  budgetMs: number;
}): Promise<void> {
  const startedAt = opts.now();
  while (opts.shouldContinue()) {
    const jobs = opts.plan();
    if (jobs.length === 0) return;
    if (opts.now() - startedAt >= opts.budgetMs) {
      for (const job of jobs) opts.fireAndForget(job);
      return;
    }
    await opts.runQueue(jobs);
  }
}

// ---------------------------------------------------------------------------
// Фоновые работы, которые не имеют права толкаться с очередью.

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Ждёт, пока пройдёт `notBefore()` И очередь стихнет. Оба условия
 *  перепроверяются по кругу: пока ждали одно, человек мог перейти ещё раз. */
export async function waitUntilSwitchSettled(
  notBefore: () => number,
  now: () => number = Date.now,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<void> {
  for (;;) {
    const wait = notBefore() - now();
    if (wait > 0) {
      await sleep(wait);
      continue;
    }
    if (!isRevalidationIdle()) {
      await whenRevalidationIdle();
      continue;
    }
    return;
  }
}

/** Интервал опроса роли: пока очередь читает сеть — пауза. */
export function rolePollInterval(baseMs: number): number | false {
  return isSilentRevalidating() ? false : baseMs;
}
