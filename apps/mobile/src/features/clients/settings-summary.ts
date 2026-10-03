import type { CardField } from "./card-prefs";

// ПОДПИСИ СТРОК ШЕСТЕРЁНКИ «КЛИЕНТОВ» — чистые, без React (владелец 02.10:
// «настройки клиентов — по функциям»). Подпись — живое состояние, а не
// пояснение.

/** Поля строки списка в порядке страницы «Строка в списке». */
export const LIST_ROW_FIELDS: { field: CardField; label: string }[] = [
  { field: "phone", label: "Телефон" },
  { field: "last", label: "Последняя запись" },
];

/** «Телефон · Последняя запись» или «Только имя». */
export function listRowSummary(prefs: Record<CardField, boolean>): string {
  const on = LIST_ROW_FIELDS.filter((f) => prefs[f.field]).map((f) => f.label);
  return on.length > 0 ? on.join(" · ") : "Только имя";
}

/** «Типы объектов»: два первых имени и многоточие, без типов — «Типов нет». */
export function objectTypesSummary(types: string[]): string {
  if (types.length === 0) return "Типов нет";
  return types.slice(0, 2).join(", ") + (types.length > 2 ? "…" : "");
}

/** «Блоки клиентов» (03.10): выключенные блоки словами страницы, иначе
 *  «Все блоки». Короче строки шестерёнки — строку списка видно на странице. */
export function blocksSummary(off: string[]): string {
  return off.length === 0 ? "Все блоки" : `Без: ${off.join(", ")}`;
}

/** «Теги»: сколько тегов у команды. */
export function tagsSummary(tags: number): string {
  if (tags === 0) return "Тегов пока нет";
  const mod10 = tags % 10;
  const mod100 = tags % 100;
  const word = mod10 === 1 && mod100 !== 11 ? "тег" : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "тега" : "тегов";
  return `${tags} ${word}`;
}
