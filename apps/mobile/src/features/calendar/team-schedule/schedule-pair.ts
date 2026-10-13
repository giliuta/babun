// Pure arithmetic of the «График команды» wheel: one pair of bounds edited
// at a time, never inverted and never wrapped through midnight.

import { timeToMinutes, type TeamSchedule } from "@babun/shared/local/schedule";
import { allDays } from "@/features/reference/schedule-days";

export type TimePair = { start: string; end: string };
export type TimePatch = { hour?: number; minute?: number };

export const hm = (v: string) => {
  const [h, m] = v.split(":").map(Number);
  return { hour: Number.isFinite(h) ? h : 0, minute: Number.isFinite(m) ? m : 0 };
};
export const text = (v: { hour: number; minute: number }) =>
  `${String(v.hour).padStart(2, "0")}:${String(v.minute).padStart(2, "0")}`;

// ПЕРЕСКОК БАРАБАНА ЧЕРЕЗ ПОЛНОЧЬ — НЕ ПРАВКА ДРУГОЙ ГРАНИЦЫ (аудит
// шестерёнки 03.10). Барабан часов закольцован: конец смены, докрученный за
// 23, становился 00 — меньше начала, и «двигаем другую границу» ставил
// начало на 00:00. Смена превращалась в 00:00–00:00, и сетка молча рисовала
// этот день общими часами. Пересчёт через полночь прижимаем к краю суток,
// другую границу не трогаем.
const WRAP_EDGE = 60;
const DAY_LAST = 23 * 60 + 55;

/** The pair after the start wheel moved. */
export function pairOnStart(edited: TimePair, patch: TimePatch): TimePair {
  const next = { ...hm(edited.start), ...patch };
  const prevStart = timeToMinutes(edited.start);
  if (prevStart < WRAP_EDGE && next.hour * 60 + next.minute >= DAY_LAST - WRAP_EDGE) {
    // 00 → 23 назад через полночь: начало остаётся в начале суток.
    return { start: "00:00", end: edited.end };
  }
  const startMin = next.hour * 60 + next.minute;
  const endMin = timeToMinutes(edited.end);
  // Конец обязан быть позже начала: у смены пару «20:00–09:00» сетка молча
  // отвергает (workBand → undefined, день красится ОБЩИМИ часами), у перерыва
  // из неё вышла бы полоса отрицательной длины. Двигаем ту границу, которую
  // сейчас не трогают, и минимально — на шаг барабана.
  const fixedEnd = startMin >= endMin ? Math.min(23 * 60 + 55, startMin + 5) : null;
  return {
    start: text(next),
    end:
      fixedEnd != null
        ? text({ hour: Math.floor(fixedEnd / 60), minute: fixedEnd % 60 })
        : edited.end,
  };
}

/** The pair after the end wheel moved. */
export function pairOnEnd(edited: TimePair, patch: TimePatch): TimePair {
  const next = { ...hm(edited.end), ...patch };
  const prevEnd = timeToMinutes(edited.end);
  if (prevEnd >= DAY_LAST - WRAP_EDGE && next.hour * 60 + next.minute < WRAP_EDGE) {
    // 23 → 00 вперёд через полночь: конец остаётся в конце суток.
    return { start: edited.start, end: "23:55" };
  }
  const endMin = next.hour * 60 + next.minute;
  const startMin = timeToMinutes(edited.start);
  const fixedStart = endMin <= startMin ? Math.max(0, endMin - 5) : null;
  return {
    start:
      fixedStart != null
        ? text({ hour: Math.floor(fixedStart / 60), minute: fixedStart % 60 })
        : edited.start,
    end: text(next),
  };
}

/** У всех рабочих дней одни часы — график читается общим видом. */
export function sameHoursEveryDay(schedule: TeamSchedule | null): boolean {
  if (!schedule) return true;
  const working = allDays(schedule)
    .map(({ day }) => day)
    .filter((d) => d.is_working);
  return working.every((d) => d.start === working[0]?.start && d.end === working[0]?.end);
}
