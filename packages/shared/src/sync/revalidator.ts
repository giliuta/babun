// BACKGROUND REVALIDATION — ONE RUN PER COMPANY AT A TIME.
//
// A cached list answers from SQLite at once and then asks the server in the
// background. Two parallel snapshots of the same company could land in any
// order, so an older one could overwrite a newer one: a second request waits
// for the run in flight instead of starting its own.
//
// A run whose cache replace was cancelled by a fresh local write is marked
// stale (`markStale`): readers waiting on it got the pre-write snapshot, so
// another run follows immediately after it.
//
// `revalidated` is emitted only on a real change, so the app's
// invalidate → refetch → revalidate cycle settles after one pass.
//
// ТО ОДНО ПЕРЕЧИТЫВАНИЕ БЫЛО ВТОРЫМ ПОЛНЫМ ЧТЕНИЕМ: сверка поменяла кэш →
// событие → экран перечитал кэш → обёртка снова спросила сервер (Android
// 28.10: `appointments select=*` дважды за 2,6 с). С `settleMs` первый вызов
// после изменившей кэш сверки — в пределах `settleMs` — не идёт в сеть: кэш
// только что сверен. Пропуск разовый. Сигнал чужой правки снимает его
// (`forgetSettledRevalidations` в мосте realtime): правка, пришедшая в это
// окно, всё равно перечитается.

import type { CachedTable } from "../db/cache/index";
import { emitRevalidated } from "./revalidate-events";

interface Revalidator<Client> {
  revalidate(client: Client, tenantId: string): Promise<void>;
  markStale(tenantId: string): void;
}

/** Разовые пропуски всех сверок, по таблице: «сверка только что поменяла
 *  кэш, следующий вызов — эхо собственного события». */
const settledByTable = new Map<CachedTable, Map<string, unknown>>();

/** Чужая правка пришла сигналом — следующая сверка обязана идти в сеть. */
export function forgetSettledRevalidations(table?: CachedTable): void {
  if (table) settledByTable.get(table)?.clear();
  else settledByTable.forEach((settled) => settled.clear());
}

export function createRevalidator<Client>(
  table: CachedTable,
  /** Pulls the server list into the cache; true when the cache changed. */
  refresh: (client: Client, tenantId: string) => Promise<boolean>,
  opts: {
    settleMs?: number;
    now?: () => number;
    /** Отметка локальных записей: правка после сверки снимает пропуск. */
    writeStamp?: () => number;
  } = {},
): Revalidator<Client> {
  const running = new Map<string, Promise<void>>();
  const stale = new Set<string>();
  const settled = new Map<string, { at: number; stamp: number }>();
  const stamp = opts.writeStamp ?? (() => 0);
  const now = opts.now ?? Date.now;
  if (opts.settleMs) settledByTable.set(table, settled);

  function revalidate(client: Client, tenantId: string): Promise<void> {
    const inFlight = running.get(tenantId);
    if (inFlight) return inFlight;
    const mark = settled.get(tenantId);
    if (mark !== undefined) {
      settled.delete(tenantId);
      if (opts.settleMs && now() - mark.at < opts.settleMs && mark.stamp === stamp()) {
        return Promise.resolve();
      }
    }
    const run = (async () => {
      try {
        if (await refresh(client, tenantId)) {
          if (opts.settleMs) settled.set(tenantId, { at: now(), stamp: stamp() });
          emitRevalidated(table);
        }
      } catch {
        // The cached list has already been returned; the UI keeps it.
      } finally {
        running.delete(tenantId);
        if (stale.delete(tenantId)) {
          // Сверка устарела ещё в полёте — её пропуск не в счёт.
          settled.delete(tenantId);
          void revalidate(client, tenantId);
        }
      }
    })();
    running.set(tenantId, run);
    return run;
  }

  return {
    revalidate,
    markStale: (tenantId) => {
      stale.add(tenantId);
      settled.delete(tenantId);
    },
  };
}
