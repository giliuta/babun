// ЧИСТАЯ ЛОГИКА БЛОКА «ФАЙЛЫ» ЗАПИСИ (STORY-070): подписи без React.

/** Имя файла на плитке: без хвоста расширения, если оно и так видно по значку. */
export function docTitle(filename: string): string {
  const trimmed = filename.trim();
  const dot = trimmed.lastIndexOf(".");
  return dot > 0 ? trimmed.slice(0, dot) : trimmed || "Документ";
}
