import { pluralRu } from "@babun/shared/common/utils/plural-ru";

// ПОДПИСИ СТРОК ШЕСТЕРЁНКИ «КЛИЕНТОВ» — чистые, без React. Подпись — живое состояние, а не
// пояснение.

/** «Типы объектов»: два первых имени и многоточие, без типов — «Типов нет». */
export function objectTypesSummary(types: string[]): string {
  if (types.length === 0) return "Типов нет";
  return types.slice(0, 2).join(", ") + (types.length > 2 ? "…" : "");
}

/** «Блоки клиентов»: выключенные блоки словами страницы, иначе
 *  «Все блоки». Короче строки шестерёнки — строку списка видно на странице. */
export function blocksSummary(off: string[]): string {
  return off.length === 0 ? "Все блоки" : `Без: ${off.join(", ")}`;
}

/** «Теги»: сколько тегов у команды. */
export function tagsSummary(tags: number): string {
  if (tags === 0) return "Тегов пока нет";
  // Форма числа — общим правилом: на других языках интерфейса «21» уже не «один».
  return `${tags} ${pluralRu(tags, ["тег", "тега", "тегов"])}`;
}
