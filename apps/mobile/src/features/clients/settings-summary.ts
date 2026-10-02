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

/** «Объекты»: выключены — так и сказано; иначе типы, срок и карты одной
 *  строкой («Дом, Квартира · Не напоминать · Google Карты, Waze»). */
export function objectsSummary(input: {
  on: boolean;
  types: string[];
  service: string;
  maps: string;
}): string {
  if (!input.on) return "Выключены в карточке";
  const types = input.types.length > 0 ? input.types.slice(0, 2).join(", ") + (input.types.length > 2 ? "…" : "") : "Типов нет";
  return [types, input.service, input.maps].filter(Boolean).join(" · ");
}

/** «Метка и тег»: выключены — так и сказано; иначе число тегов. */
export function labelsSummary(on: boolean, tags: number): string {
  if (!on) return "Выключены в карточке";
  if (tags === 0) return "Тегов пока нет";
  const mod10 = tags % 10;
  const mod100 = tags % 100;
  const word = mod10 === 1 && mod100 !== 11 ? "тег" : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "тега" : "тегов";
  return `${tags} ${word}`;
}
