import { PERIOD_LABELS, type Period } from "@/lib/period";

// The period facet: its value type and the human label of a period.

// ── Period ─────────────────────────────────────────────────────────

/** Период — общий диалект приложения (точно так же, как в Финансах): пресеты парами текущий/прошлый из
 *  finances/period + «Свой период» с колёс С–До. null везде = «Всё
 *  время» (нет фильтра) — состояние, которого у Финансов не бывает. */
export type PeriodValue = Period;

const M_GEN = [
  "янв",
  "фев",
  "мар",
  "апр",
  "мая",
  "июн",
  "июл",
  "авг",
  "сен",
  "окт",
  "ноя",
  "дек",
];

/** Именительный падеж — подписи целых месяцев («Июнь», «Март — Май»). */
const M_NOM = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];

function fmtShort(key: string): string {
  const [, mo, d] = key.split("-").map(Number);
  if (!mo || !d) return key;
  return `${d} ${M_GEN[mo - 1]}`;
}

/** Подпись периода: пресет называется по имени («Текущий месяц»), свой
 *  диапазон — умно: целые месяцы по имени («Июнь», «Март — Май»,
 *  «Ноябрь ’25»), произвольные даты — числами («1 июн–15 июн»).
 *  Используется токеном бара и сводкой в шапке листа. */
export function periodLabel(period: PeriodValue): string {
  if (period.preset !== "custom") return PERIOD_LABELS[period.preset];
  const [fy, fm, fd] = period.from.split("-").map(Number);
  const [ty, tm, td] = period.to.split("-").map(Number);
  if (!fy || !ty) return "Период";
  const curYear = new Date().getFullYear();
  const lastDay = new Date(ty, tm, 0).getDate();
  const monthAligned = fd === 1 && td === lastDay;
  if (monthAligned) {
    const fLbl = `${M_NOM[fm - 1]}${fy !== curYear ? ` ’${String(fy).slice(2)}` : ""}`;
    if (fy === ty && fm === tm) return fLbl;
    const tLbl = `${M_NOM[tm - 1]}${ty !== curYear ? ` ’${String(ty).slice(2)}` : ""}`;
    return `${fLbl} — ${tLbl}`;
  }
  return `${fmtShort(period.from)}–${fmtShort(period.to)}`;
}
