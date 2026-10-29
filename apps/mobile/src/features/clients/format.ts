import { pluralRu } from "@babun/shared/common/utils/plural-ru";

// Date / plural helpers shared across the clients feature — extracted
// from ClientHeader / ClientNextJob / VisitsBlock / FinanceBlock /
// ObjectsBlock, which each kept an identical private copy.

const MONTHS_RU_SHORT = [
  "янв", "фев", "мар", "апр", "мая", "июн",
  "июл", "авг", "сен", "окт", "ноя", "дек",
];

/** "2024-05-10" → "10 мая"; прошлый год дописывается («10 мая ’24»),
 *  иначе позапрошлогодний визит читается как свежий — ровно на той оси,
 *  ради которой существует сортировка. invalid/empty → "". */
export function formatShortDateRu(key: string): string {
  if (!key) return "";
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return "";
  const base = `${d} ${MONTHS_RU_SHORT[m - 1] ?? ""}`.trim();
  const curYear = new Date().getFullYear();
  return y === curYear ? base : `${base} ’${String(y).slice(2)}`;
}

/** 1 → «запись», 2–4 → «записи», 5+ → «записей» (mod10/mod100 rules,
 *  so 21 → «запись», 22 → «записи»). «Визит» в интерфейсе не говорим:
 *  сущность продукта — «Запись» (пачка 5, Т1). */
export function visitsWord(n: number): string {
  // Форма числа — общим правилом: на других языках интерфейса «21» уже не «один».
  return pluralRu(n, ["запись", "записи", "записей"]);
}

/** YYYY-MM-DD через n дней (локальная TZ) — пресеты «Напомнить»
 *  (карточка и long-press меню списка). */
export function ymdInDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
