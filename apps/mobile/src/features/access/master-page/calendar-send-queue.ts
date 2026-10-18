// СПИСОК КАЛЕНДАРЕЙ ЧЕЛОВЕКА УХОДИТ НА СЕРВЕР ЦЕЛИКОМ (`set_member_calendars`
// заменяет набор, а не дописывает одну команду). Поэтому новый набор нельзя
// считать от карточки: до ответа на первый тап она ещё рисует старый список,
// и второй быстрый тап отправил бы набор без первой команды — сервер молча
// открепил бы её. Набор считается от ПОСЛЕДНЕГО отправленного, а отправки
// идут по одной, в порядке тапов: иначе ответы могли бы лечь наоборот.

export interface CalendarSendQueue {
  /** Последний набор, ушедший в очередь; `null` — очередь пуста, правда в карточке. */
  latest: readonly string[] | null;
  /** Сколько отправок ещё не получили ответ. */
  pending: number;
  /** Хвост цепочки: следующая отправка стартует после него. */
  tail: Promise<unknown>;
}

export function createCalendarSendQueue(): CalendarSendQueue {
  return { latest: null, pending: 0, tail: Promise.resolve() };
}

/** Набор, от которого считать следующий тап: последний отправленный, а без
 *  отправок в пути — тот, что показывает карточка. */
export function queuedTeamIds(
  queue: CalendarSendQueue,
  shown: readonly string[],
): readonly string[] {
  return queue.latest ?? shown;
}

/** Поставить набор в очередь. Набор становится «последним» сразу, до ответа,
 *  — следующий тап посчитается уже от него. Ошибка отправки возвращается
 *  позвавшему и цепочку не рвёт. */
export function sendInOrder<T>(
  queue: CalendarSendQueue,
  next: readonly string[],
  send: (teamIds: readonly string[]) => Promise<T>,
): Promise<T> {
  queue.latest = next;
  queue.pending += 1;
  const run = queue.tail.then(() => send(next));
  queue.tail = run.catch(() => undefined);
  const settle = () => {
    queue.pending -= 1;
    if (queue.pending === 0) queue.latest = null;
  };
  run.then(settle, settle);
  return run;
}
