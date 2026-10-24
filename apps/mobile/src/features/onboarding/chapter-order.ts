// ОЧЕРЁДНОСТЬ РАЗДЕЛОВ В ОБУЧЕНИИ — чистые правила, без React и базы:
// их читают и вкладки (`tab-locks.tsx`), и запуск глав, и тесты.

/** Главы по порядку разблокировки разделов. */
export const CHAPTER_ORDER = ["calendar", "finances", "clients", "cabinet"] as const;
export type ChapterId = (typeof CHAPTER_ORDER)[number];

/** Главы, которые уже написаны. Глава, которой нет в коде, считается
 *  пройденной: иначе её раздел и все следующие остались бы закрытыми навсегда. */
export const WRITTEN_CHAPTERS: ReadonlySet<ChapterId> = new Set(CHAPTER_ORDER);

export type TabWithChapter = Exclude<ChapterId, "calendar">;

/** Раздел закрыт, пока не пройдены все главы перед ним. */
export function lockedByOnboarding(done: readonly string[] | null | undefined, tab: TabWithChapter): boolean {
  if (!done) return false;
  const before = CHAPTER_ORDER.slice(0, CHAPTER_ORDER.indexOf(tab));
  return before.some((c) => WRITTEN_CHAPTERS.has(c) && !done.includes(c));
}

/** Что записать в базу, когда глава обучения закончилась. Вступление,
 *  доведённое до конца, — это открытый раздел, а не пройденная глава: ничего.
 *  Крестик на вступлении закрывает саму главу. */
export function progressToSave(
  finished: { id: string; intro?: string },
  how: "end" | "chapter" | "all",
): ChapterId | "all" | null {
  if (how === "all") return "all";
  if (how === "end" && finished.intro) return null;
  const id = finished.intro ?? finished.id;
  return (CHAPTER_ORDER as readonly string[]).includes(id) ? (id as ChapterId) : null;
}

/** Первая непройденная написанная глава. */
export function nextChapter(done: readonly string[] | null | undefined): ChapterId | null {
  if (!done) return null;
  return CHAPTER_ORDER.find((c) => WRITTEN_CHAPTERS.has(c) && !done.includes(c)) ?? null;
}
