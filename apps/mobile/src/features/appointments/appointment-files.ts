// ЧИСТАЯ ЛОГИКА БЛОКА «ФАЙЛЫ» ЗАПИСИ (STORY-070): подписи без React.

/** Имя файла на плитке: без хвоста расширения, если оно и так видно по значку. */
export function docTitle(filename: string): string {
  const trimmed = filename.trim();
  const dot = trimmed.lastIndexOf(".");
  return dot > 0 ? trimmed.slice(0, dot) : trimmed || "Документ";
}

/** Видео или фото — по расширению пути в бакете: таблица одна на оба. */
export function isVideoPath(path: string): boolean {
  return /\.(mp4|mov|m4v)$/i.test(path.trim());
}
