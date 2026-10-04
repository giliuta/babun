// ОТКАЗ В ПРАВКЕ ТЕГА — СЛОВАМИ (аудит прав клиентов 03.10). Хранилище
// тегов отдаёт сырой текст Postgres с именем функции впереди
// («createClientTag: new row violates row-level security…»); партнёру без
// права «Теги» показывалось именно это. Как у источников (`friendly` в
// `acquisition-sources.ts`): право, повтор имени, остальное — без приставки.
//
// Лист без React — проверяется тестом напрямую.

const NO_RIGHT = "Нет права менять теги этой команды.";

export function tagWriteWords(message: string | undefined | null): string {
  const raw = (message ?? "").replace(/^(create|update|delete|reorder|setHidden)ClientTags?:\s*/i, "");
  if (!raw) return "Проверьте соединение и попробуйте ещё раз.";
  if (/client_tags.*name|duplicate key/i.test(raw)) return "Такой тег у команды уже есть.";
  // Политика, которая прячет строку, на `.single()` отвечает «0 строк».
  if (/row-level security|permission denied|JSON object requested|0 rows|PGRST116/i.test(raw)) return NO_RIGHT;
  return raw;
}
