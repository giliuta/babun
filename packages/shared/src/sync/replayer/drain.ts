// One drain pass over the queue: gates (network, tenant, session, write
// lock), per-row ordering holds, backoff, quota gate and dispatch.

import {
  dequeueAll,
  cacheGetOne,
  type QueuedOp,
  type CachedTable,
} from "../../db/cache/sql";
// Go through the emit-wrappers so the OfflineIndicator badge updates the
// moment the replayer succeeds/fails an op, instead of waiting for the 5-s
// safety poll.
import { writesBlocked } from "../write-guard";
import { isTransientNetworkError, isTransportFailure } from "../transient-error";
import { isUuid } from "../uuid";
import {
  removeOpAndEmit as removeOp,
  bumpAttemptAndEmit as bumpAttempt,
  markOpPermanentlyFailedAndEmit,
} from "../queue-events";
import { dispatch } from "./dispatch";
import {
  boundTenantOf,
  hasLiveSession,
  readTenantId,
  TenantSwitchedMidway,
} from "./guards";
import {
  BACKOFFS_MS,
  isQuotaError,
  MAX_ATTEMPTS,
  type ReplayerOptions,
} from "./options";
import { sleep } from "./relay";
import {
  awaitedParentId,
  GUARDED_CONFLICT_MESSAGE,
  parentInsertId,
} from "./table-rules";

// ОБРЫВ С ОТВЕТОМ СЕРВЕРА НЕ ДЕРЖИТ ПРАВКУ ВЕЧНО.
//
// Обрыв попытки не тратит — иначе минута лежащей базы хоронила бы всю
// офлайн-работу. Но «обрыв», на который сервер ОТВЕЧАЕТ (5xx, таймаут
// запроса на тяжёлом триггере), может оказаться постоянным: такая правка
// крутилась бы каждые 30 с без конца и держала перечитку календаря
// (`tenant-refresh.ts`) — чужие брони и оплаты на телефоне не появлялись бы.
// Поэтому ответы сервера считаются подряд по правке: после
// `SERVER_TRANSIENT_STREAK_LIMIT` проходов (около десяти минут) каждый
// следующий идёт в счёт попыток, и правка по исчерпании уходит в «не
// удалось». Чистый обрыв (ответа не было) не считается никогда: это сеть, и
// она вернётся.
export const SERVER_TRANSIENT_STREAK_LIMIT = 20;
const serverTransientStreak = new Map<QueuedOp["id"], number>();

/** ТОЛЬКО ДЛЯ ТЕСТОВ: счёт живёт в памяти процесса, а номера операций в
 *  каждом тесте начинаются заново. */
export function __resetTransientStreaksForTests(): void {
  serverTransientStreak.clear();
}

/** Обрыв держит правку без траты попытки — или его пора считать. */
function transientHolds(op: QueuedOp, err: unknown): boolean {
  if (isTransportFailure(err)) return true;
  const streak = (serverTransientStreak.get(op.id) ?? 0) + 1;
  serverTransientStreak.set(op.id, streak);
  return streak < SERVER_TRANSIENT_STREAK_LIMIT;
}

/** Отпечаток очереди: менялось ли в ней что-то за проход. */
function queueSignature(ops: readonly QueuedOp[]): string {
  return ops.map((o) => `${o.id}:${o.attempts}`).join(",");
}

export async function drain(
  opts: ReplayerOptions,
  /** A network blip held an op: schedule the next pass. */
  onTransientFailure: () => void,
): Promise<void> {
  // Без сети не сливаем: всё упало бы сразу. Сольёт возврат сети.
  if (opts.isOnline && !opts.isOnline()) return;
  const ops = await dequeueAll(); // in enqueue order (id ASC), not by device clock
  if (ops.length === 0) return;
  const signatureBefore = queueSignature(ops);
  let transientFailure = false;

  // Компания, под которой слив НАЧАЛСЯ. Сверяется с живой перед каждой
  // операцией: переход посреди слива обязан его прервать, а не дописать
  // остаток уже в другую компанию.
  const gateTenantId = readTenantId(opts);
  // ХОСТ ЗНАЕТ КОМПАНИЮ, А ЕЁ НЕТ — НЕ СЛИВАЕМ ВОВСЕ. Гейт ниже без
  // компании не работает, и операции ушли бы без всякой проверки компании, а
  // после выхода из аккаунта — ещё и без входа.
  if (opts.currentTenantId && !gateTenantId) return;

  // ПРИВЯЗАННЫМ КЛИЕНТОМ НЕ СЛИВАЕМ ВОВСЕ. Не «пропускаем чужие операции», а
  // выходим целиком: такой клиент отправит ЛЮБУЮ операцию под своим
  // заголовком, в том числе операцию активной компании, которая гейт проходит
  // честно. Fail-closed: клиент объявил себя привязанным — значит он не для
  // выгрузки, даже если привязан к той же компании.
  if (boundTenantOf(opts.supabase)) return;

  // ПОКА ИДЁТ ПРОСМОТР ЧУЖИМИ ГЛАЗАМИ, ОЧЕРЕДЬ НЕ ТРОГАЕМ. Засов отбивает
  // отправку, а слив этого не знает: каждая операция получила бы отказ,
  // трижды (`MAX_ATTEMPTS`) — и вся несохранённая офлайн-работа владельца
  // легла бы «ждать ручного повтора» из-за одного перехода Wi-Fi↔LTE за
  // полминуты предпросмотра. Выходим целиком, как при привязанном клиенте:
  // операции остаются в очереди и уедут, когда просмотр кончится.
  if (writesBlocked()) return;

  // БЕЗ ВХОДА НЕ СЛИВАЕМ. Запрос без сессии уходит анонимом, а
  // аноним по RLS не видит ни одной строки: удаление «удаляет» ноль строк,
  // правка не находит строку, и обе снимались бы как выполненные. Между
  // выходом и тем, как хост погасит компанию (`forgetActiveTenantId`), есть
  // окно — его закрывает эта проверка. Операции ждут следующего толчка.
  if (!(await hasLiveSession(opts.supabase))) return;

  // СТРОКИ, ЧЬЯ ПРАВКА УПАЛА В ЭТОМ ПРОХОДЕ. Следующие правки той же строки
  // ждут следующего прохода: уйди они сейчас, упавшая старая правка
  // долетела бы ПОСЛЕ них и перезаписала свежую (пример: растяжка 14:30→15:00
  // на 504, возврат к 14:30 — и в базе снова 15:00). Порядок жестов по одной
  // строке — закон; разные строки друг друга не держат.
  //
  // НАВСЕГДА УПАВШАЯ ПРАВКА ДЕРЖИТ СВОЮ СТРОКУ ТОЖЕ.
  // Если её пропускать раньше этой проверки, следующие правки той же
  // строки уходят без неё: (а) создание записи сверх лимита упало навсегда
  // — правки следом находили ноль строк и снимались молча как «удалено на
  // другом устройстве», а «Повторить» создавал запись с исходным телом;
  // (б) перенос упал навсегда, человек вернул время, правка применилась — и
  // «Повторить» на старой ставил старое время поверх нового. Поэтому цепочка
  // строки ждёт ручного «Повторить» целиком («Синхронизация» и повторяет, и
  // удаляет её целиком).
  const heldRows = new Set<string>();
  const rowKey = (o: QueuedOp) => `${o.table}:${o.row_id}`;
  // КЛИЕНТ, ЧЬЯ ВСТАВКА НЕ УШЛА, ДЕРЖИТ И СВОИ ЗАПИСИ . Клиент и запись, заведённые без сети: вставка клиента упала
  // (5xx, «номер уже заведён») — вставка записи падала следом на внешнем
  // ключе и за три прохода становилась «навсегда не отправленной», хотя
  // виноват не она. Поэтому запись ждёт своего клиента, попыток не тратя.
  const heldClientInserts = new Set<string>();
  const hold = (o: QueuedOp) => {
    heldRows.add(rowKey(o));
    const parentId = parentInsertId(o);
    if (parentId !== null) heldClientInserts.add(parentId);
  };
  const waitsForClient = (o: QueuedOp) => {
    const clientId = awaitedParentId(o);
    return clientId !== null && heldClientInserts.has(clientId);
  };
  // Свежий сторож строки после применившейся правки (см. `forwardQueuedSentinel`):
  // в памяти — для правок этого же прохода, в базе — для следующих.
  const sentinels = new Map<string, { from: string; to: string }>();

  for (const op of ops) {
    let legacyUpdate = false;
    if (heldRows.has(rowKey(op))) continue;
    if (waitsForClient(op)) {
      heldRows.add(rowKey(op));
      continue;
    }
    if (op.attempts >= MAX_ATTEMPTS) {
      // Already failed permanently — leave in queue so the UI can
      // show the manual-retry button. Manual retry resets attempts.
      hold(op);
      continue;
    }

    // ГЕЙТ ПО КОМПАНИИ. Очередь ПЕРЕЖИВАЕТ переход в другую компанию —
    // переход бережёт местный кэш, — поэтому здесь лежат операции, поставленные
    // под другой компанией, и слить их под текущей нельзя.
    //
    // Чем это кончается, если не удержать. Вставку сервер отобьёт: у каждой
    // стоит `with check (tenant_id = current_tenant_id())`. А вот УДАЛЕНИЕ
    // отбить нечем — под чужой компанией оно просто не найдёт строку, вернёт
    // ноль строк БЕЗ ошибки, и операция уйдёт из очереди как выполненная.
    // Человек удалил запись, очередь пуста, запись на месте.
    if (gateTenantId) {
      const liveTenantId = readTenantId(opts);
      if (liveTenantId !== gateTenantId) {
        // Компания сменилась ПОСРЕДИ слива. Дальше не идём вовсе: остаток
        // сольёт следующий kick — уже под новой компанией и под её заголовком.
        break;
      }

      let payloadTenant = (op.payload as { tenant_id?: unknown })?.tenant_id;
      if (
        (typeof payloadTenant !== "string" || payloadTenant.length === 0)
        && op.op === "update"
      ) {
        // СТАРЫЕ ПРАВКИ КОМПАНИИ В ТЕЛЕ НЕ НЕСУТ. Обёртки клали её во вставку и
        // удаление, а в правку — нет, и гейт молча пропускал бы такую
        // операцию на каждом круге: она не уходит, не падает и держит очередь.
        // Держит буквально: пока в очереди висит правка записи, перечитка
        // записей с сервера не идёт вовсе (`appointmentsCached`), и календарь
        // телефона замирает — оплата, принятая сервером, на экране остаётся
        // «не оплачено». Компания такой
        // правки — компания самой строки в кэше.
        const cached = await cacheGetOne(op.table as CachedTable, op.row_id).catch(
          () => null,
        );
        payloadTenant = (cached as { tenant_id?: unknown } | null)?.tenant_id;
        legacyUpdate = true;
      }
      if (typeof payloadTenant !== "string" || payloadTenant.length === 0) {
        // ОПЕРАЦИЯ БЕЗ КОМПАНИИ НЕ ВЫГРУЖАЕТСЯ ВОВСЕ: отправить её — значит
        // отдать серверу решать, в какую компанию писать, а он возьмёт
        // ТЕКУЩУЮ. Но и молча лежать ей нельзя — молчаливый пропуск держал
        // очередь вечно. Она уходит в «не удалось» с причиной: видна в
        // очереди, там её удаляют руками, и перечитка больше не ждёт её.
        const msg = "Операция без компании — отправлять её некуда";
        await markOpPermanentlyFailedAndEmit(op.id, msg);
        opts.onPermanentFailure?.({ ...op, attempts: MAX_ATTEMPTS, last_error: msg });
        hold(op);
        continue;
      }
      if (payloadTenant !== liveTenantId) continue;
    }

    // v452 — fail-fast for non-UUID row_ids targeting uuid id
    // columns. These are unrecoverable: the row was never accepted
    // by Postgres in the first place, and replaying any op against
    // a synthetic local id (`apt-...`) returns the same 22P02
    // «invalid input syntax for type uuid» error. Mark perm-failed
    // immediately so the SyncQueuePanel's «Удалить» button is the
    // only action shown.
    if ((op.op === "delete" || op.op === "update") && !isUuid(op.row_id)) {
      const msg = `non-uuid row_id: "${op.row_id}" — local orphan, cannot replay`;
      await markOpPermanentlyFailedAndEmit(op.id, msg);
      opts.onPermanentFailure?.({
        ...op,
        attempts: MAX_ATTEMPTS,
        last_error: msg,
      });
      hold(op);
      continue;
    }

    // Soft-throttle: if this op was recently attempted, wait its
    // backoff. We measure attempts->backoff naively; the queue
    // doesn't carry last_attempt_at to keep the schema small.
    if (op.attempts > 0) {
      const backoff = BACKOFFS_MS[Math.min(op.attempts - 1, BACKOFFS_MS.length - 1)] ?? 30000;
      await sleep(backoff);
    }

    // STORY-052 G4 — pre-gate offline INSERTs on the tier quota (when a
    // gate is injected). Quota failures are KNOWN-PERMANENT (waiting +
    // retrying won't free up tier headroom), so mark perm-failed
    // immediately instead of burning 3 retry windows. UI shows the row in
    // SyncQueuePanel with last_error so the user knows why + can upgrade
    // and manually retry from the panel. No gate → skip entirely.
    if (op.op === "insert" && opts.quota) {
      try {
        await opts.quota.assertAvailable(op);
      } catch (err) {
        if (isQuotaError(err)) {
          const msg = err.message || "Quota exceeded";
          await markOpPermanentlyFailedAndEmit(op.id, msg);
          opts.onPermanentFailure?.({
            ...op,
            attempts: 999,
            last_error: msg,
          });
          hold(op);
          continue;
        }
        // Non-quota error in the gate — fall through to normal
        // dispatch + bump-attempt path so a transient blip doesn't
        // permanently fail the op.
      }
    }

    // ПЕРЕПРОВЕРКА ПЕРЕД САМОЙ ОТПРАВКОЙ. Между проверкой наверху и этой
    // строкой прошли ДВА ожидания: откат попытки (до тридцати секунд) и
    // сторож тарифа. За тридцать секунд человек успевает сменить компанию —
    // и тогда операция уйдёт под чужим заголовком. Проверка наверху нужна,
    // чтобы не начинать; эта — чтобы не доотправить начатое.
    if (gateTenantId && readTenantId(opts) !== gateTenantId) break;

    const carried = sentinels.get(rowKey(op));
    const sendOp =
      carried && op.op === "update" && op.expected_updated_at === carried.from
        ? { ...op, expected_updated_at: carried.to }
        : op;
    try {
      const conflict = await dispatch(
        opts.supabase,
        sendOp,
        legacyUpdate,
        (to, from = op.expected_updated_at ?? undefined) => {
          if (from) sentinels.set(rowKey(op), { from, to });
        },
        gateTenantId ? () => readTenantId(opts) === gateTenantId : undefined,
      );
      if (conflict === "server-won") {
        opts.onConflict?.(GUARDED_CONFLICT_MESSAGE);
      } else if (conflict) {
        opts.onConflict?.(
          "Запись была обновлена на другом устройстве. Применены ваши изменения.",
        );
      }
      serverTransientStreak.delete(op.id);
      await removeOp(op.id);
    } catch (err) {
      // Сменилась компания — не ошибка операции: попытку не считаем, слив
      // обрываем, как это делает проверка перед отправкой.
      if (err instanceof TenantSwitchedMidway) break;
      const msg = err instanceof Error ? err.message : String(err);
      hold(op);
      // Обрыв — попытку не тратим: строка ждёт следующего прохода.
      if (isTransientNetworkError(err) && transientHolds(op, err)) {
        transientFailure = true;
        continue;
      }
      await bumpAttempt(op.id, msg);
      // If we just exceeded the cap, surface to UI once.
      if (op.attempts + 1 >= MAX_ATTEMPTS) {
        opts.onPermanentFailure?.({
          ...op,
          attempts: op.attempts + 1,
          last_error: msg,
        });
      }
      // Don't bail the entire drain on one failure — keep going so
      // ops behind a poisoned one still get their chance.
    }
  }

  if (transientFailure) onTransientFailure();
  // ПЕРЕЧИТКА — ТОЛЬКО КОГДА ОЧЕРЕДЬ ПРАВДА ИЗМЕНИЛАСЬ. Хост на `onChanged`
  // перечитывает календарь, а перечитка при непустой очереди сама толкает
  // слив: проход, где ничего не ушло (обрыв), крутил этот круг без конца.
  const signatureAfter = queueSignature(await dequeueAll().catch(() => ops));
  if (signatureAfter !== signatureBefore) opts.onChanged?.();
}
