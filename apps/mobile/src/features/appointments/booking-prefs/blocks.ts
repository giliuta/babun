// Block catalogue of the record and event forms: ids, labels, the switch keys
// in a team's «Дизайн» and the movable body order. Definitions only.
import { orderMovable } from "../block-order";
import type { TeamBlockKey } from "../team-design";

export type BookingBlockId =
  | "team"
  | "label"
  | "when"
  | "client"
  | "object"
  | "services"
  | "payment"
  | "note"
  | "files";

export interface BookingBlockDef {
  id: BookingBlockId;
  label: string;
  /** Без этого блока записи нет — в настройках стоит всегда включённым. */
  pinned?: boolean;
}

// ПОДПИСЕЙ У СТРОК НЕТ, И ПОЛЯ ПОД НИХ ТОЖЕ (владелец 2026-09-04: «эти
// подсказки просто ненужные»).
// ВСЕ БЛОКИ СТРАНИЦЫ, В ПОРЯДКЕ СТРАНИЦЫ (владелец 2026-09-06: «в настройках
// добавь блок команда, метка, время, клиент, объект, услуга, оплата, заметка,
// файл»). Команда, время, клиент и услуги закреплены: без них записи нет.
export const BOOKING_BLOCKS: BookingBlockDef[] = [
  { id: "team", label: "Команда", pinned: true },
  { id: "label", label: "Метка" },
  { id: "when", label: "Время", pinned: true },
  { id: "client", label: "Клиент", pinned: true },
  { id: "object", label: "Объект" },
  { id: "services", label: "Услуги", pinned: true },
  { id: "payment", label: "Оплата" },
  { id: "note", label: "Заметка" },
  { id: "files", label: "Файлы" },
];

/** Ключ блока записи в «Дизайне» команды. */
export const RECORD_BLOCK_KEY: Partial<Record<BookingBlockId, TeamBlockKey>> = {
  label: "record_label",
  object: "record_object",
  payment: "record_payment",
  note: "record_note",
  files: "record_files",
};

// ПОРЯДОК БЛОКОВ — У КОМАНДЫ (владелец 11.10: «брат хотел бы менять
// местонахождение блока — поставить первым объект, вторым клиент — и самому
// редактировать»). Двигаются блоки ТЕЛА формы; команда с меткой и время —
// шапка записи («кто, куда, когда») и стоят сверху всегда. Порядок хранится в
// строке «Записей» команды (`team_design.record_order/event_order`) и потому
// одинаков у всей команды — как и выключенные блоки.

/** Подвижные блоки записи в заводском порядке — так форма стояла всегда. */
export const RECORD_MOVABLE: readonly BookingBlockId[] = [
  "client",
  "object",
  "services",
  "payment",
  "note",
  "files",
];

/** Подвижные блоки события в заводском порядке — как стоит форма события. */
export const EVENT_MOVABLE: readonly EventBlockId[] = [
  "type",
  "client",
  "object",
  "note",
  "files",
];

/** Полный порядок формы: шапка как в определениях, затем тело в порядке
 *  команды. */
export function orderForm<T extends string>(
  all: readonly { id: T }[],
  movable: readonly T[],
  stored: readonly string[] | null | undefined,
): T[] {
  const head = all.map((b) => b.id).filter((id) => !movable.includes(id));
  return [...head, ...orderMovable(movable, stored)];
}

// ── БЛОКИ СОБЫТИЯ ──
// Свои, не общие с записью (владелец 24.09: «на странице дизайна — выбор
// блоков в записи, выбор блоков в событиях»; миграция 20260924230000). Время
// и команда закреплены: без них события нет. Тип — нет (владелец 24.09:
// «можно вообще без типа — событие останется как обычная запись с
// заметкой»). Порядок — как у записи, чтобы на странице «Дизайн» одинаковые
// блоки стояли напротив друг друга. Объект события включён, только когда у
// компании вообще есть объекты (`objects`).

export type EventBlockId =
  | "team"
  | "type"
  | "when"
  | "label"
  | "client"
  | "object"
  | "note"
  | "files";

export interface EventBlockDef {
  id: EventBlockId;
  label: string;
  pinned?: boolean;
}

export const EVENT_BLOCKS: EventBlockDef[] = [
  { id: "team", label: "Команда", pinned: true },
  { id: "label", label: "Метка" },
  { id: "when", label: "Время", pinned: true },
  // Тип — под временем, как его и рисует форма события (список настроек
  // прежде ставил его после объекта и расходился с формой).
  { id: "type", label: "Тип" },
  { id: "client", label: "Клиент" },
  { id: "object", label: "Объект" },
  { id: "note", label: "Заметка" },
  { id: "files", label: "Файлы" },
];

export const EVENT_BLOCK_KEY: Partial<Record<EventBlockId, TeamBlockKey>> = {
  label: "event_label",
  type: "event_type",
  client: "event_client",
  object: "event_object",
  note: "event_note",
  files: "event_files",
};
