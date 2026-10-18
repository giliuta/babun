// Block levels of a record and an event page. Types only.

export type RecordLevel = "hidden" | "read" | "write";

export interface RecordBlocks {
  /** Команда и мастер записи. */
  team: RecordLevel;
  /** Метка записи. */
  label: RecordLevel;
  /** Дата, время и длительность: меняет тот, кто переносит («Переносить»). */
  when: RecordLevel;
  client: RecordLevel;
  object: RecordLevel;
  /** Услуги в записи — строки работ. Состав меняет «Сумма и услуги: Меняет». */
  services: RecordLevel;
  /** Сумма записи — цены в строках, скидка, «Итого». */
  amount: RecordLevel;
  payment: RecordLevel;
  files: RecordLevel;
  /** Заметка записи — своё право «Заметка». Пока сервер его не
   *  проверяет — читают все, не пишет никто. Статуса нет. */
  note: RecordLevel;
  /** Цвет записи: видят все, красит — «Цвет записи». */
  color: RecordLevel;
  /** Блок «SMS» внизу записи — история сообщений её клиенту. */
  sms: RecordLevel;
}

/** БЛОКИ СОБЫТИЯ (что можно видеть и что редактировать). Видит — во всех событиях команды;
 *  меняет — только своё событие при «Записи событий: Видит и создаёт»
 *  (`bookRights`). Команда и время видны всегда. */
export interface EventBlocks {
  label: RecordLevel;
  /** Тип — название и цвет события. */
  type: RecordLevel;
  client: RecordLevel;
  object: RecordLevel;
  note: RecordLevel;
  files: RecordLevel;
}
