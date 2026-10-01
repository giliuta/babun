import type { ClientStats } from "@babun/shared/local/selectors/client-stats";

// ДАТА В СТРОКЕ КЛИЕНТА — ОДНА, И ЦВЕТОМ (владелец 01.10: «делаем просто
// последний визит; если он не закрыт — жёлтым, как долг; синий — то, что уже
// получили прибыль; серый — то, что предстоит; если нет записи — вообще
// ничего не ставится»).
//
// Лист без React: правило читают строка списка и тест.

export type VisitMarkKind = "done" | "unclosed" | "ahead";

export interface VisitMark {
  date: string;
  kind: VisitMarkKind;
}

/** Какую дату и каким цветом поставить в строке клиента. */
export function visitMark(
  stats: Pick<ClientStats, "lastVisitDate" | "lastUnclosedDate" | "nextApt"> | undefined,
): VisitMark | null {
  if (!stats) return null;
  // Последним был визит, который никто не закрыл, — он и есть «последний».
  if (stats.lastUnclosedDate && stats.lastUnclosedDate > stats.lastVisitDate) {
    return { date: stats.lastUnclosedDate, kind: "unclosed" };
  }
  if (stats.lastVisitDate) return { date: stats.lastVisitDate, kind: "done" };
  // Визитов ещё не было, но он записан — дата записи впереди.
  if (stats.nextApt) return { date: stats.nextApt.date, kind: "ahead" };
  return null;
}
