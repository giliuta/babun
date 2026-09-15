import { useSyncExternalStore } from "react";
import { onlineManager } from "@tanstack/react-query";
import { queryClient } from "@/lib/query-client";
import { getActiveTenantId } from "@/lib/active-tenant";
import {
  REVALIDATE_BUDGET_MS,
  REVALIDATE_JOB_CAP_MS,
  SWITCH_REVALIDATE_CONCURRENCY,
  SWITCH_REVALIDATE_DELAY_MS,
  abandonRevalidationPhase,
  beginRevalidationPhase,
  endRevalidationPhase,
  isCurrentRevalidation,
  isSilentRevalidating,
  markRevalidationRunning,
  planSwitchRevalidation,
  revalidateUntilSettled,
  runRevalidationQueue,
  subscribeSwitchRevalidation,
  withTimeCap,
  type RevalidationCandidate,
} from "@/lib/switch-revalidate-plan";

export { isSilentRevalidating };

// ТИХОЕ ДООБНОВЛЕНИЕ НОВОЙ КОМПАНИИ ПОСЛЕ ПЕРЕХОДА.
//
// Переход больше не помечает кэш протухшим (`auth-clear.ts`): первый кадр
// новой компании рисуется из того, что уже лежит в памяти. Но лежащее может
// быть многоминутной давности — его и перечитывает эта очередь, фоном и
// по два запроса за раз, чтобы не собрать в очереди бесплатного плана тот же
// залп, от которого уходили. Правила — в листе `switch-revalidate-plan.ts`.

/** Тихая очередь как состояние экрана. Голое чтение модуля в рендере не
 *  перерисует экран, когда фаза кончится: начавшееся в ней настоящее
 *  перечитывание осталось бы без полосы до своего конца. */
export function useSilentRevalidating(): boolean {
  return useSyncExternalStore(
    subscribeSwitchRevalidation,
    isSilentRevalidating,
    isSilentRevalidating,
  );
}

function candidates(): RevalidationCandidate[] {
  return queryClient
    .getQueryCache()
    .getAll()
    .map((query) => ({
      queryKey: query.queryKey,
      queryHash: query.queryHash,
      hasData: query.state.data !== undefined,
      dataUpdatedAt: query.state.dataUpdatedAt,
      isInvalidated: query.state.isInvalidated,
      active: query.isActive(),
      fetching: query.state.fetchStatus === "fetching",
    }));
}

async function revalidate(tenantId: string, generation: number): Promise<void> {
  // ТРИ УСЛОВИЯ ПЕРЕД КАЖДЫМ ЧТЕНИЕМ. Фаза своя (не началась новая), компания
  // устройства всё ещё та, и сеть есть (без неё чтение встало бы в паузу и
  // держало очередь до таймаута).
  //
  // ЧЕГО ЭТА СВЕРКА НЕ ДЕЛАЕТ. Она покрывает только СТАРТ перечитывания.
  // Запрос берёт заголовок в момент отправки, а SQLite-обёртки (записи,
  // клиенты, теги) отдают снимок сразу и шлют страницы и фоновое
  // перечитывание уже после — переход в эти секунды отправил бы их под другой
  // компанией. Гонку потери данных закрывает то, что их `queryFn` читают
  // клиентом, привязанным к компании ключа (`tenantBoundClient`).
  const stillOurs = (): boolean =>
    isCurrentRevalidation(generation) &&
    getActiveTenantId() === tenantId &&
    onlineManager.isOnline();
  try {
    if (!stillOurs() || !markRevalidationRunning(generation)) return;
    const done = new Set<string>();
    const run = (job: RevalidationCandidate): Promise<void> => {
      // Сделанным считается только то, что правда перечитали. Экран, закрытый
      // между планом и чтением, иначе остался бы «сделанным» — и, открытый
      // снова в эту же фазу, под длинным порогом не перечитался бы никем.
      const query = queryClient.getQueryCache().get(job.queryHash);
      if (!query?.isActive()) return Promise.resolve();
      done.add(job.queryHash);
      return withTimeCap(
        queryClient.refetchQueries(
          { queryKey: job.queryKey, exact: true, type: "active" },
          // Уже летящий запрос не перезапускаем — дожидаемся его.
          { cancelRefetch: false },
        ),
        REVALIDATE_JOB_CAP_MS,
      );
    };
    // Проходы — до пустого плана, а не до числа проходов: экран, открытый во
    // время последнего прохода, иначе остался бы непрочитанным (разбор у
    // `REVALIDATE_BUDGET_MS`).
    await revalidateUntilSettled({
      plan: () => planSwitchRevalidation(candidates(), tenantId, Date.now(), done),
      runQueue: (jobs) =>
        runRevalidationQueue({
          jobs,
          concurrency: SWITCH_REVALIDATE_CONCURRENCY,
          shouldContinue: stillOurs,
          run,
        }),
      fireAndForget: (job) => {
        if (stillOurs()) void run(job);
      },
      shouldContinue: stillOurs,
      now: Date.now,
      budgetMs: REVALIDATE_BUDGET_MS,
    });
  } finally {
    endRevalidationPhase(generation);
  }
}

/** Зовёт переход ДО смены компании: с этого мгновения ключи `tenantId` живут
 *  под длинным порогом, и первый кадр не уходит в сеть за тем, что очередь
 *  перечитает сама. */
export function beginSwitchRevalidation(
  tenantId: string,
  knownTenantIds: readonly string[],
): void {
  const generation = beginRevalidationPhase(tenantId, knownTenantIds);
  setTimeout(() => {
    void revalidate(tenantId, generation);
  }, SWITCH_REVALIDATE_DELAY_MS);
}

/** Переход сорвался. Если компания всё же сменилась, фазу не трогаем — ключи
 *  новой компании по-прежнему нужно дообновить. */
export function abandonSwitchRevalidation(tenantId: string): void {
  if (getActiveTenantId() === tenantId) return;
  abandonRevalidationPhase(tenantId);
}
