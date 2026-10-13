import type { WorkBand } from "./types";

/** Where the grey off-hours wash stops and starts inside the visible window. */
export type WorkWash = {
  /** The band in force (its breaks are drawn too); null — a day off. */
  band: WorkBand | null;
  workStart: number;
  workEnd: number;
};

export function workWash({
  workBand,
  workStartHour,
  workEndHour,
  startHour,
  endHour,
}: {
  workBand: WorkBand | null | undefined;
  workStartHour: number | undefined;
  workEndHour: number | undefined;
  startHour: number;
  endHour: number;
}): WorkWash {
  const winStartMin = startHour * 60;
  const winEndMin = endHour * 60;
  // Off-hours wash band: per-date team schedule wins (workBand), else the
  // global hour props.
  //
  // ВЫХОДНОЙ ЗАКРАШЕН ЦЕЛИКОМ (владелец 2026-08-17: «просто не подсвечивается и
  // всё, остаётся как будто в прошлом»). До этого `band === null` ГАСИЛО wash
  // совсем — обе полосы схлопывались на края окна, и колонка выходного
  // оставалась БЕЛОЙ среди серых нерабочих часов рабочих дней. То есть
  // единственный нерабочий день выглядел единственным подсвеченным — ровно
  // наоборот смыслу. Теперь у выходного рабочей полосы нет вовсе, и весь день
  // ложится под тот же серый, которым закрыты нерабочие часы: язык один.
  const band =
    workBand === undefined
      ? {
          startMin: (workStartHour ?? startHour) * 60,
          endMin: (workEndHour ?? endHour) * 60,
        }
      : workBand;
  // Клэмп с ОБЕИХ сторон: рабочее окно целиком вне видимого давало
  // MinuteBand с top<0 / height>100% — теперь весь видимый день просто
  // корректно серый.
  const clampWin = (min: number) =>
    Math.min(Math.max(min, winStartMin), winEndMin);
  const workStart = band ? clampWin(band.startMin) : winStartMin;
  // Ноль рабочего времени у выходного: полоса «после смены» начинается на
  // верхней кромке окна и кроет колонку целиком одним слоем.
  const workEnd = band ? clampWin(band.endMin) : winStartMin;
  return { band, workStart, workEnd };
}
