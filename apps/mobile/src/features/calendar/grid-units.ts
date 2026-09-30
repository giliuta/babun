import type { DimensionValue } from "react-native";
import { pad2 } from "@/features/appointments/helpers";

// ЕДИНИЦЫ СЕТКИ — общие у колонки дня (`DayView`) и блока записи
// (`AppointmentBlock`). Вынесены из DayView при разрезе файла 24.09: обе
// части считают время и проценты одними и теми же функциями.

/** Ширина рельса времени слева от сетки. */
export const RAIL_W = 48;
/** Зазор между соседними блоками в колонке. */
export const GAP = 3;

export const minToHM = (min: number) =>
  `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;

/** Дата `ymd`, сдвинутая на `days` дней (по местной полуночи). */
export const shiftYmd = (ymd: string, days: number) => {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, (d || 1) + days);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
};

const DOW_SHORT = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
/** «Пт 26» — день, куда встанет запись, для подписи на карточке. */
export const dayShort = (ymd: string, days: number) => {
  const [y, m, d] = shiftYmd(ymd, days).split("-").map(Number);
  return `${DOW_SHORT[new Date(y, m - 1, d).getDay()]} ${d}`;
};

// ZOOM GEOMETRY: всё внутри колонки позиционируется в ПРОЦЕНТАХ её высоты —
// щипок анимирует одну высоту, Yoga пересчитывает сетку сама.
export const pct = (part: number, total: number): DimensionValue =>
  `${(part / total) * 100}%`;

/** Минимальная высота карточки: обвязка 9pt + одна строка текста. Ниже —
 *  блок без текста, только заливка, кант и знаки. */
export const MIN_H = (lineH: number) => 9 + lineH;
