import type { Appointment } from "@babun/shared/local/appointments";
import type { WorkBand } from "@/features/calendar/DayView";
import { toMin } from "@/features/calendar/layout";

// СВОБОДНЫЕ СЛОТЫ ДНЯ — «куда можно поставить запись» (владелец 2026-08-07:
// «нажимаю Записать → открывается неделя с зелёными кубиками, кубики только
// в рабочее время; выбираю кубик — открывается форма»).
//
// Слот зелёный, когда одновременно:
//   • он внутри рабочей полосы бригады (нерабочий день — слотов нет вовсе);
//   • не попадает на перерыв (обед);
//   • не пересекается с чужой записью ЭТОЙ бригады — с учётом БУФЕРА на
//     дорогу: 30 минут после визита это не «свободно», это переезд;
//   • не в прошлом (сегодня утренние часы предлагать нечего).
//
// Отменённые записи не считаются занятыми — это призраки. Личные события и
// «весь день» тоже блокируют: бригада в отпуске никуда не поедет.
//
// Длина кубика = ШАГ СЕТКИ (решение владельца): услуга выбирается позже, в
// форме, и точная длительность там же и встанет. Кубик отвечает на вопрос
// «сюда можно начать», а не «сколько это займёт».

export interface FreeSlot {
  /** Начало слота в минутах от полуночи. */
  startMin: number;
  /** «09:30» — то, что напечатано на кубике и уедет в форму записи. */
  time: string;
}

export function hhmm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Занят ли отрезок [startMin, endMin) записями бригады с учётом буфера. */
function busy(
  startMin: number,
  endMin: number,
  appts: readonly Appointment[],
  bufferMinutes: number,
): boolean {
  for (const a of appts) {
    if (blocks(a)) return true;
  }
  return false;

  function blocks(a: Appointment): boolean {
    // Отменённая запись — призрак: время снова свободно.
    if (a.status === "cancelled") return false;
    // «Весь день» съедает сутки целиком.
    if (a.event_all_day === true) return true;
    const s = toMin(a.time_start ?? "");
    const e = toMin(a.time_end ?? "");
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return false;
    // Буфер добавляется ПОСЛЕ чужой записи и ПЕРЕД ней: дорога нужна в обе
    // стороны.
    return startMin < e + bufferMinutes && endMin + bufferMinutes > s;
  }
}

export function freeSlotsForDay(opts: {
  /** Рабочая полоса бригады: null — выходной, undefined — графика нет. */
  band: WorkBand | null | undefined;
  /** Фолбэк, когда у бригады нет своего графика: общие рабочие часы. */
  fallback: { startMin: number; endMin: number };
  /** Записи ЭТОГО дня и ЭТОЙ бригады. */
  appts: readonly Appointment[];
  /** Шаг сетки в минутах — он же длина кубика. */
  stepMinutes: number;
  /** Зазор на дорогу между визитами. */
  bufferMinutes: number;
  /** Сколько минут уже прошло сегодня; для будущих дней — null. */
  nowMinutes: number | null;
}): FreeSlot[] {
  const { band, fallback, appts, stepMinutes, bufferMinutes, nowMinutes } = opts;
  // Выходной бригады — предлагать нечего.
  if (band === null) return [];
  const startMin = band?.startMin ?? fallback.startMin;
  const endMin = band?.endMin ?? fallback.endMin;
  if (!(endMin > startMin) || stepMinutes <= 0) return [];

  const step = Math.max(5, Math.round(stepMinutes));
  const breaks = band?.breaks ?? [];
  const out: FreeSlot[] = [];

  for (let s = startMin; s + step <= endMin; s += step) {
    const e = s + step;
    if (nowMinutes !== null && s < nowMinutes) continue;
    if (breaks.some((b) => s < b.endMin && e > b.startMin)) continue;
    if (busy(s, e, appts, bufferMinutes)) continue;
    out.push({ startMin: s, time: hhmm(s) });
  }
  return out;
}
