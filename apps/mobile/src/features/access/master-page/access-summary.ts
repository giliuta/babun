import { LEVEL_WORD, type AccessBlock } from "../access-map";
import { visibleLevel, type MasterDraft } from "./master-draft";
import { offeredBlocks } from "./rights-copy";

// БЛОК «ДОСТУП» — СВОДКА ПО РАЗДЕЛАМ ПРИЛОЖЕНИЯ (этап 1 плана 29.09: владелец
// «набор прав, календари и права в компании — объединить в один блок»).
// В реестре календарные права лежат одним разделом «Записи», а владелец
// думает разделами приложения: что человек может в КАЛЕНДАРЕ (новые записи,
// перенос, события, метки дня, график), что в ЗАПИСИ (клиент, объект,
// услуги, оплата…) и что в ФИНАНСАХ. Группа — по началу ключа блока.

export type CalendarGroup = "calendar" | "record" | "finance";

export const CALENDAR_GROUPS: readonly CalendarGroup[] = ["calendar", "record", "finance"];

export const CALENDAR_GROUP_TITLE: Record<CalendarGroup, string> = {
  calendar: "Календарь",
  record: "Запись",
  finance: "Финансы",
};

/** Родительный падеж — для «без клиента и суммы». */
const GENITIVE: Record<string, string> = {
  "calendar.create": "новых записей",
  "calendar.move": "переноса",
  "calendar.cancel": "отмены",
  "calendar.events": "событий",
  "calendar.day_labels": "меток дня",
  "calendar.schedule": "графика",
  "record.status": "статуса",
  "record.team": "команды",
  "record.label": "метки",
  "record.client": "клиента",
  "record.object": "объекта",
  "record.services": "услуг",
  "record.amount": "цен",
  "record.color": "цвета",
  "record.payment": "оплаты",
  "record.files": "файлов",
  "finance.operations": "операций",
  "finance.accounts": "счетов",
  "finance.debts": "долгов",
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

/** Порядок строк раздела: у записи — как на её странице, у прочих — реестр. */
export function orderGroupRows<T extends { block: { key: string } }>(
  group: CalendarGroup | undefined,
  rows: readonly T[],
): T[] {
  if (group !== "record") return [...rows];
  const rank = (key: string) => {
    const at = RECORD_ROW_ORDER.indexOf(key);
    return at === -1 ? RECORD_ROW_ORDER.length : at;
  };
  return [...rows].sort((a, b) => rank(a.block.key) - rank(b.block.key));
}

/** Живые календарные блоки группы, в порядке реестра. */
export function groupBlocks(blocks: readonly AccessBlock[], group: CalendarGroup): AccessBlock[] {
  return offeredBlocks(blocks).filter(
    (block) => block.scope === "calendar" && !block.ownerOnly && block.key.startsWith(`${group}.`),
  );
}

/** Права группы в одном календаре одной фразой: «Не видит», «Видит»,
 *  «Меняет», «без клиента и суммы», «видит 3 из 9», «видит, меняет часть».
 *  Пустая строка — в группе нет живых блоков, строки на карточке нет. */
export function calendarGroupLine(
  blocks: readonly AccessBlock[],
  draft: MasterDraft,
  teamId: string,
  group: CalendarGroup,
): string {
  const shown = visibleLevel(blocks, draft);
  const rows = groupBlocks(blocks, group).map((block) => {
    const level = shown(block, teamId);
    const top = block.levels[block.levels.length - 1];
    return { key: block.key, level, atTop: level === top, closable: block.levels.includes("off") };
  });
  if (rows.length === 0) return "";
  const closed = rows.filter((row) => row.level === "off");
  // Блоки без «Не видит» (статус, команда записи) видны всегда: «ничего не
  // видит» — это когда закрыто всё, что вообще закрывается.
  if (closed.length === rows.filter((row) => row.closable).length && closed.length > 0) {
    return LEVEL_WORD.off;
  }
  if (closed.length === 0) {
    if (rows.every((row) => row.atTop)) {
      return rows.some((row) => row.level === "write") ? LEVEL_WORD.write : LEVEL_WORD.read;
    }
    return rows.some((row) => row.level === "write") ? "Видит, меняет часть" : LEVEL_WORD.read;
  }
  const named = closed.map((row) => GENITIVE[row.key]);
  if (closed.length <= 2 && named.every(Boolean)) return `Без ${named.join(" и ")}`;
  return `Видит ${rows.length - closed.length} из ${rows.length}`;
}
