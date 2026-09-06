// ЧИСТАЯ ЛОГИКА БЛОКА «ФАЙЛЫ» ЗАПИСИ (STORY-070): подписи без React.

/** «1 документ», «2 документа», «5 документов». */
export function docsWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} документ`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${n} документа`;
  return `${n} документов`;
}

/** Строка состояния блока: «Нет файлов» · «3 фото» · «3 фото · 1 документ». */
export function filesCaption(photos: number, docs: number): { text: string; empty: boolean } {
  if (photos === 0 && docs === 0) return { text: "Нет файлов", empty: true };
  const parts: string[] = [];
  if (photos > 0) parts.push(`${photos} фото`);
  if (docs > 0) parts.push(docsWord(docs));
  return { text: parts.join(" · "), empty: false };
}

/** Короткая бирка на плитке: только когда фото размечено «до» или «после». */
export function photoTag(kind: "before" | "after" | "other"): string | null {
  return kind === "before" ? "До" : kind === "after" ? "После" : null;
}

/** Имя файла на плитке: без хвоста расширения, если оно и так видно по значку. */
export function docTitle(filename: string): string {
  const trimmed = filename.trim();
  const dot = trimmed.lastIndexOf(".");
  return dot > 0 ? trimmed.slice(0, dot) : trimmed || "Документ";
}
