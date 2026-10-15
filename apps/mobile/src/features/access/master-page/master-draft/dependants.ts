// Dependant blocks: what folds and resets under a hidden parent, and the
// rows that carry a companion right.

import type { AccessBlock, AccessChange, AccessLevel } from "@/session/access-map";
import { defaultLevel } from "./draft";

/** Зависимые блоки: пока главный скрыт, их строки на странице прав свёрнуты,
 *  а выставленное в них сбрасывается. «Новые записи» без «Календаря и записей»
 *  — право на то, чего человек не видит; «Телефоны клиентов» без «Клиентов» —
 *  тоже. Зависимые живут в той же области действия, что и главный
 *  (реестр `access_blocks`): календарные — в том же календаре. */
export const DEPENDANT_BLOCKS: Readonly<Record<string, readonly string[]>> = {
  // Деньги календаря — тоже под «Календарём и записями» (этап 2): сервер
  // открывает финансы в календаре, только если сам календарь не скрыт
  // (`access_calendars`), а карта прав такой календарь не несёт вовсе. Без
  // свёртки владелец выставил бы «Меняет» в деньгах скрытого календаря — и у
  // человека не открылось бы ничего.
  "calendar.records": [
    // «Ограничения» записей: записей не видит — и окна у них нет.
    "calendar.window",
    "calendar.create",
    "calendar.move",
    "calendar.cancel",
    "calendar.events",
    "event.label",
    "event.type",
    "event.client",
    "event.object",
    "event.note",
    "event.files",
    "calendar.schedule",
    "record.note",
    "record.team",
    "record.client",
    "record.object",
    "record.services",
    "record.amount",
    "record.payment",
    "record.label",
    "record.color",
    "record.files",
    "record.sms",
    "calendar.day_labels",
    "calendar.identity",
    "calendar.timezone",
    "calendar.hours",
    "calendar.booking_form",
    "calendar.services",
    "calendar.labels",
    // Доход и расход дня — деньги этого календаря.
    "calendar.day_money",
    "finance.income",
    "finance.expense",
    "finance.accounts",
    "finance.debts",
    "finance.documents",
    // «Прибыль» и шестерёнка финансов — деньги той же
    // команды: скрыт календарь — свёрнуты и они.
    "finance.profit",
    "finance.window",
    "finance.settings_accounts",
    "finance.settings_trash",
    "finance.settings_categories_income",
    "finance.settings_categories_expense",
    "finance.settings_categories_debts",
    // «Валюта» и «Реквизиты» — права НА ВСЮ КОМПАНИЮ: скрытый календарь одной
    // команды не гасит их у всей компании (сброс писал бы `team_id: null`).
  ],
  // Скрыты «Карточки клиентов» — нет ни охвата, ни номера, ни одного блока
  // карточки (защита базы).
  clients: [
    "clients.scope",
    "clients.create",
    "clients.menu",
    "clients.delete",
    "clients.note",
    "clients.people",
    "clients.objects",
    "clients.labels",
    "clients.tags",
    "clients.personal",
    "clients.files",
    "clients.requisites",
    "clients.client",
    "clients.history",
    "clients.sms",
    "clients.settings_card",
    "clients.settings_ways",
    "clients.settings_objects",
    "clients.settings_maps",
    "clients.settings_tags",
    "clients.settings_sources",
  ],
  // ЦЕПОЧКА ВНУТРИ ЗАПИСИ:
  // скрыты услуги — не видно и цен; скрыты цены — оплату не принять, сколько
  // брать, не видно. Строки сворачиваются, положения сбрасываются.
  "record.services": ["record.amount", "record.payment"],
  "record.amount": ["record.payment"],
  // Блоки события — под «Записями событий»: скрыты события — блоков нет.
  // Сами «Записи событий» стоят под «Записями клиентов», поэтому и блоки
  // события сворачиваются вместе с ними.
  "calendar.events": ["event.label", "event.type", "event.client", "event.object", "event.note", "event.files"],
  // МЕТКА ЗАПИСИ И СОБЫТИЯ — ПОД «МЕТКОЙ ДНЯ» (скрыть метку дня и видеть метку
  // в записи выглядит странно).
  // Запись без своей метки показывает метку своего дня (`labelFromDay`):
  // скрыть день и оставить метку записи — значит показать половину.
  "calendar.day_labels": ["record.label", "event.label"],
};

/** Главные, чьи зависимые при скрытии НЕ сбрасываются, а только серые:
 *  правило держит сервер (`20260930070000_labels_under_day_label`), и
 *  открыли «Метку дня» — вернулось то, что стояло в метке записи. */
const KEEPS_DEPENDANTS: ReadonlySet<string> = new Set(["calendar.day_labels"]);

/** Что сбросить вместе со скрытием главного блока. */
export function resetOnHide(parentKey: string): readonly string[] {
  return KEEPS_DEPENDANTS.has(parentKey) ? [] : (DEPENDANT_BLOCKS[parentKey] ?? []);
}

/** «ЗАПИСИ КЛИЕНТОВ» ВЕДУТ «НОВЫЕ ЗАПИСИ». Одна строка на два
 *  права: `calendar.records` — видит ли он записи команды (его проверяет
 *  лента записей на сервере), `calendar.create` — создаёт ли новые (его
 *  проверяет `member_appointment_create`). Строки «Новые записи» отдельно нет. */
export const RECORDS_KEY = "calendar.records";
export const CREATE_KEY = "calendar.create";
/** «Перенос записей» ведёт «Цвет записи» (разрешённый перенос — это и
 *  перемещение, и копирование, и цвет): всё меню записи по долгому нажатию — одно право. */
export const MOVE_KEY = "calendar.move";
export const COLOR_KEY = "record.color";

/** Ступень строки «Записи клиентов» из двух прав: скрыты — «Скрыты»; видит
 *  и создаёт — «Видит и создаёт»; иначе — «Только видит». */
export function recordsRowLevel(records: AccessLevel, create: AccessLevel): AccessLevel {
  if (records === "off") return "off";
  return create === "write" ? "write" : "read";
}

/** Что ставится вместе со ступенью блока. У «Записей клиентов» — «Новые
 *  записи»: «Может» при «Видит и создаёт», иначе «Не может». При «Скрыты» их
 *  и так сбрасывает свёртка (`dependantResets`): второй раз один блок в набор
 *  не попадает — сервер такой набор отказывает. */
export function companionLevels(blockKey: string, level: AccessLevel): Record<string, AccessLevel> {
  if (blockKey === MOVE_KEY) return { [COLOR_KEY]: level === "write" ? "write" : "off" };
  if (blockKey !== RECORDS_KEY || level === "off") return {};
  return { [CREATE_KEY]: level === "write" ? "write" : "off" };
}

/** Строка права влита в другую и отдельно не рисуется: «Новые записи» — в
 *  «Записи клиентов», «Цвет записи» — в «Перенос записей», когда главная
 *  строка есть на странице (сервер её проверяет). */
export function isMergedRow(key: string, offeredKeys: ReadonlySet<string>): boolean {
  return (
    (key === CREATE_KEY && offeredKeys.has(RECORDS_KEY)) ||
    (key === COLOR_KEY && offeredKeys.has(MOVE_KEY))
  );
}

/** Главные блоки зависимого — все, от кого он зависит («Оплата» — от
 *  «Записей клиентов», «Услуг» и «Цен»). Пусто — ни от кого. */
export function parentBlocksOf(key: string): string[] {
  return Object.entries(DEPENDANT_BLOCKS)
    .filter(([, dependants]) => dependants.includes(key))
    .map(([parent]) => parent);
}

/** Строка блока свёрнута: скрыт хоть один её главный блок. `parentLevel` —
 *  положение главного в том же календаре (или в компании); один и тот же
 *  вопрос задают и черновик, и карта живого сотрудника. */
export function isBlockFolded(
  key: string,
  parentLevel: (parentKey: string) => AccessLevel,
): boolean {
  return parentBlocksOf(key).some((parent) => parentLevel(parent) === "off");
}

/** Что сбросить у живого сотрудника вместе со скрытием главного блока — те же
 *  правила, что `withLevel` у черновика, в форме `set_member_access`. Сбрасываем
 *  на умолчание: такое изменение сервер пишет удалением строки. Одного блока
 *  дважды в наборе нет — сервер такой набор отказывает. */
export function dependantResets(
  blocks: readonly AccessBlock[],
  block: AccessBlock,
  level: AccessLevel,
  teamId: string | null,
): AccessChange[] {
  if (level !== "off") return [];
  const out: AccessChange[] = [];
  for (const key of resetOnHide(block.key)) {
    const dependant = blocks.find((candidate) => candidate.key === key);
    if (!dependant || dependant.ownerOnly || dependant.area === "owner") continue;
    if (dependant.scope === "calendar" && teamId === null) continue;
    out.push({
      block: dependant.key,
      team_id: dependant.scope === "calendar" ? teamId : null,
      level: defaultLevel(dependant),
    });
  }
  return out;
}
