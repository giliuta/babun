// «УДАЛЁННЫЕ ОПЕРАЦИИ»: повтор и двойное действие не должны давать красный тост.
//
// «Вернуть» и «Удалить насовсем» забирают снимок из ящика, поэтому они не
// идемпотентны: второе нажатие (повтор после таймаута, двойной свайп) находит
// пустоту и получает отказ «Операции нет в «Удалённых»». Это не поломка, а
// ответ «уже сделано» — экран перечитывает ящик и говорит это спокойно.

/** Текст отказа сервера, когда снимка уже нет (вернули, стёрли, вышел срок). */
export const NOT_IN_TRASH = "Операции нет в «Удалённых»";

/** Отказ значит «уже нет в ящике», а не «не вышло». */
export function trashAlreadyGone(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return message.includes(NOT_IN_TRASH);
}

/** Флаг «действие по строке уже идёт»: второй тап по той же строке ничего не
 *  запускает, пока первое не закончилось. Не состояние экрана — перерисовка
 *  не нужна, нужна мгновенная синхронная защита. */
export function createRowGuard(): {
  enter: (id: string) => boolean;
  leave: (id: string) => void;
  busy: (id: string) => boolean;
} {
  const running = new Set<string>();
  return {
    enter(id) {
      if (running.has(id)) return false;
      running.add(id);
      return true;
    },
    leave(id) {
      running.delete(id);
    },
    busy: (id) => running.has(id),
  };
}
