// Date / plural helpers shared across the clients feature — extracted
// from ClientHeader / ClientNextJob / VisitsBlock / FinanceBlock /
// ObjectsBlock, which each kept an identical private copy.

export const MONTHS_RU_SHORT = [
  "янв", "фев", "мар", "апр", "мая", "июн",
  "июл", "авг", "сен", "окт", "ноя", "дек",
];

/** "2024-05-10" → "10 мая"; invalid/empty → "". */
export function formatShortDateRu(key: string): string {
  if (!key) return "";
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return "";
  return `${d} ${MONTHS_RU_SHORT[m - 1] ?? ""}`.trim();
}

/** "2024-05-10" → "10 мая 2024 г." (ru-RU, with year); invalid → input. */
export function formatVisitDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return new Date(y, m - 1, d).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** 1 → «визит», 2–4 → «визита», 5+ → «визитов» (mod10/mod100 rules,
 *  so 21 → «визит», 22 → «визита»). */
export function visitsWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "визит";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "визита";
  return "визитов";
}

/** reminder_at (YYYY-MM-DD) → метка бейджа напоминания: «сегодня», когда
 *  день настал, иначе короткая дата; due = сегодня или прошло (пора
 *  действовать — красный). null — напоминания нет. Один источник для
 *  строки списка и шапки карточки. */
export function reminderBadge(
  reminderAt: string | null | undefined,
): { label: string; due: boolean } | null {
  if (!reminderAt) return null;
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (reminderAt === today) return { label: "сегодня", due: true };
  return {
    label: formatShortDateRu(reminderAt) || reminderAt,
    due: reminderAt < today,
  };
}

/** YYYY-MM-DD через n дней (локальная TZ) — пресеты «Напомнить»
 *  (карточка и long-press меню списка). */
export function ymdInDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
