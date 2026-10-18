// Revalidation queue runners: worker pool, time cap, passes until a plan is
// empty. Dependency-free like the entry, so tests call them directly.

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
