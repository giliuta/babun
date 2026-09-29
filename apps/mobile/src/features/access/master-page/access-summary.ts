// РАЗДЕЛЫ ПРАВ КОМАНДЫ — РАЗДЕЛЫ ПРИЛОЖЕНИЯ (владелец 29.09). В реестре
// календарные права лежат одним разделом «Записи», а владелец думает
// разделами приложения: что человек может в КАЛЕНДАРЕ (новые записи, перенос,
// события, метки дня, график), что в ЗАПИСИ (клиент, объект, услуги, оплата…),
// в ФИНАНСАХ и с КЛИЕНТАМИ. Группа — по началу ключа блока.

export type CalendarGroup = "calendar" | "record" | "finance" | "clients";

export const CALENDAR_GROUPS: readonly CalendarGroup[] = ["calendar", "record", "finance", "clients"];

/** Блок в разделе: «clients» — сам блок `clients` и его `clients.*`. */
export function inGroup(key: string, group: CalendarGroup): boolean {
  return key === group || key.startsWith(`${group}.`);
}

export const CALENDAR_GROUP_TITLE: Record<CalendarGroup, string> = {
  calendar: "Календарь",
  record: "Запись",
  finance: "Финансы",
  // С 29.09 клиенты — право команды (миграция `clients_rights_per_team`).
  clients: "Клиенты",
};

/** ПРАВА ЗАПИСИ — В ПОРЯДКЕ БЛОКОВ СТРАНИЦЫ ЗАПИСИ (`BOOKING_BLOCKS`:
 *  команда, метка, время, клиент, объект, услуги, оплата, заметка, файлы).
 *  Цвет — к метке (оба про вид записи в сетке), цены — сразу под услугами,
 *  статус со своей заметкой — на месте заметки. Время записи правит
 *  «Переносить» раздела «Календарь». */
export const RECORD_ROW_ORDER: readonly string[] = [
  "record.team",
  "record.label",
  "record.color",
  "record.client",
  "record.object",
  "record.services",
  "record.amount",
  "record.payment",
  "record.status",
  "record.files",
];

/** ПРАВА КАЛЕНДАРЯ. Метка дня — первой (владелец 29.09: «поставь метку
 *  первым»), дальше — что он делает с записями (новые, перенос, отмена) и что
 *  видит вокруг них (события, график). */
export const CALENDAR_ROW_ORDER: readonly string[] = [
  "calendar.day_labels",
  "calendar.records",
  "calendar.create",
  "calendar.move",
  "calendar.cancel",
  "calendar.events",
  "calendar.schedule",
];

/** БЛОКИ НА СТРАНИЦЕ РАЗДЕЛА ДОСТУПА (владелец 29.09: «первый блок —
 *  главное календаря, потом второй блок — свои значения, третий — свои»).
 *  Карточка со своей шапкой на каждый блок; право, не вошедшее ни в один,
 *  встаёт последней карточкой без шапки. У раздела без блоков — одна
 *  карточка без шапки: имя раздела уже в шапке страницы. */
export interface SectionBlock {
  key: string;
  title: string;
  keys: readonly string[];
}

/** Права блока «Записи» на странице «Календарь». */
const RECORD_KINDS: readonly string[] = ["calendar.records", "calendar.events"];

export const SECTION_BLOCKS: Partial<Record<CalendarGroup, readonly SectionBlock[]>> = {
  calendar: [
    {
      key: "main",
      title: "Главное",
      keys: CALENDAR_ROW_ORDER.filter((key) => !RECORD_KINDS.includes(key)),
    },
    // «Записи клиентов» и «Записи событий» — своим блоком «Записи»
    // (владелец 30.09: «создай второй блок — „Записи"»; «событие тоже
    // опускаем в блок „Записи"»).
    { key: "records", title: "Записи", keys: RECORD_KINDS },
  ],
};

/** Порядок строк раздела: запись — как на её странице, календарь — от
 *  частого к редкому, прочие — реестр. */
export function orderGroupRows<T extends { block: { key: string } }>(
  group: CalendarGroup | undefined,
  rows: readonly T[],
): T[] {
  const order = group === "record" ? RECORD_ROW_ORDER : group === "calendar" ? CALENDAR_ROW_ORDER : null;
  if (!order) return [...rows];
  const rank = (key: string) => {
    const at = order.indexOf(key);
    return at === -1 ? order.length : at;
  };
  return [...rows].sort((a, b) => rank(a.block.key) - rank(b.block.key));
}
