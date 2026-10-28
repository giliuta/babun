import type { ClientStats } from "@babun/shared/local/selectors/client-stats";

// ДАТА В СТРОКЕ КЛИЕНТА — ОДНА, И ЦВЕТОМ: последний визит; не закрыт —
// жёлтым, как долг; синий — прибыль уже получена; серый — предстоит; нет
// записи — ничего не ставится.
//
// Лист без React: правило читают строка списка и тест.

type VisitMarkKind = "done" | "unclosed" | "ahead";

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
