import type { WorkBand } from "./types";

/** Where the grey off-hours wash stops and starts inside the visible window. */
export type WorkWash = {
  /** The band in force (its breaks are drawn too); null — a day off. */
  band: WorkBand | null;
  workStart: number;
  workEnd: number;
  /** Working stretches of the day: the shift minus breaks, inside the window. */
  workSegs: { from: number; to: number }[];
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
  // ВЫХОДНОЙ ЗАКРАШЕН ЦЕЛИКОМ. Если `band === null` гасит wash совсем, обе
  // полосы схлопываются на края окна, и колонка выходного остаётся БЕЛОЙ среди
  // серых нерабочих часов рабочих дней: единственный нерабочий день выглядит
  // единственным подсвеченным — ровно наоборот смыслу. Поэтому у выходного
  // рабочей полосы нет вовсе, и весь день ложится под тот же серый, которым закрыты нерабочие часы: язык один.
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

  // Рабочие отрезки дня: смена минус перерывы, в границах окна. Только на
  // них ложатся серый «прошло» и плёнка метки — нерабочее закрыто одним
  // слоем и под ними не темнеет и не окрашивается.
  const workSegs: { from: number; to: number }[] = [];
  if (workEnd > workStart) {
    const breaks = (band?.breaks ?? [])
      .map((b) => ({ from: clampWin(b.startMin), to: clampWin(b.endMin) }))
      .filter((b) => b.to > b.from)
      .sort((a, b) => a.from - b.from);
    let cur = workStart;
    for (const b of breaks) {
      if (cur >= workEnd) break;
      if (b.from > cur) workSegs.push({ from: cur, to: Math.min(b.from, workEnd) });
      cur = Math.max(cur, b.to);
    }
    if (cur < workEnd) workSegs.push({ from: cur, to: workEnd });
  }
  return { band, workStart, workEnd, workSegs };
}
