// One serial queue for every scheduler operation: each runs after the
// previous one settles, whatever its outcome.
let schedulerQueue: Promise<void> = Promise.resolve();

export function enqueueScheduler<T>(task: () => Promise<T>): Promise<T> {
  const run = schedulerQueue.then(task, task);
  schedulerQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
