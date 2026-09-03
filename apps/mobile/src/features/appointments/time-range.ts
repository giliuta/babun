// ОТРЕЗОК ВРЕМЕНИ ЗАПИСИ: сдвиг начала ТЯНЕТ ЗА СОБОЙ КОНЕЦ.
//
// Попап «Когда» правил начало и конец по отдельности: сдвинул начало с 13:00
// на 15:00 — конец 16:15 стоял на месте, и три часа работы превращались в
// час с четвертью. Это тот же приём, что в Календаре iPhone: перенос начала
// переносит всю встречу, длительность остаётся. Длительность у записи
// приходит из услуг, и человек, двигая начало, её не менял.
//
// Конец правится СВОИМ барабаном — там длительность и меняют осознанно.

import { pad2 } from "@/features/appointments/helpers";

/** Минут в сутках минус одна: за полночь запись не переваливает. */
const LAST_MINUTE = 23 * 60 + 59;
/** Длительность по умолчанию, когда исходный отрезок пуст или вывернут. */
const FALLBACK_MINUTES = 60;

function toMinutes(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

function toHM(total: number): string {
  const clamped = Math.max(0, Math.min(LAST_MINUTE, total));
  return `${pad2(Math.floor(clamped / 60))}:${pad2(clamped % 60)}`;
}

/** Новое начало с сохранённой длительностью. У кромки суток конец упирается в
 *  23:59 — записи через полночь нет, и укорачивание честнее заворота. */
export function shiftRangeStart(
  timeStart: string,
  timeEnd: string,
  nextStart: string,
): { timeStart: string; timeEnd: string } {
  const duration = toMinutes(timeEnd) - toMinutes(timeStart);
  const keep = duration > 0 ? duration : FALLBACK_MINUTES;
  return { timeStart: nextStart, timeEnd: toHM(toMinutes(nextStart) + keep) };
}
