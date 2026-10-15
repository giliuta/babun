import type { Appointment } from "@babun/shared/local/appointments";
import type { FreeSlotRange, WorkBand } from "./types";

export type DayColumnProps = {
  dateYmd: string;
  appointments: Appointment[];
  clientName: (a: Appointment) => string;
  serviceLabel?: (a: Appointment) => string | null;
  /** Куда ехать — четвёртая строка блока: снимок адреса записи, иначе адрес
   *  клиента. null — не показывать. */
  addressFor?: (a: Appointment) => string | null;
  teamColorFor?: (a: Appointment) => string | null;
  /** Цвет метки САМОЙ записи, когда она отличается от метки дня
   *  (`resolveOffDayLabel`): блок получает ТОЧКУ этим цветом в нижнем углу —
   *  периметр занят цветом самой записи. null — обычный блок. */
  offLabelColorFor?: (a: Appointment) => string | null;
  isToday: boolean;
  /** Бизнес-сегодня (YYYY-MM-DD) — просрочка записей и затемнение
   *  прошедших дней. Не задан → оба сигнала выключены. */
  todayYmd?: string;
  compact?: boolean;
  onEdit: (a: Appointment) => void;
  /** Долгое нажатие без движения по блоку — контекстное меню записи. */
  onMenu?: (a: Appointment) => void;
  /** Undefined for read-only calendars: empty slots are plain grid cells. */
  onCreateAt?: (dateYmd: string, timeStart: string) => void;
  /** Долгое нажатие по свободному времени — быстрое меню («Перерыв»,
   *  «Метка дня») без формы записи. */
  onSlotLongPress?: (dateYmd: string, timeStart: string) => void;
  /** Запись в режиме правки («Двигать и растягивать» из меню записи): только
   *  у неё палец двигает и тянет за края, и только пока режим включён. */
  editingId?: string | null;
  onReschedule?: (
    a: Appointment,
    newStart: string,
    newEnd: string,
    date?: string,
  ) => void;
  /** Per-record mutation guard (shared team events are creator-only). */
  canReschedule?: (a: Appointment) => boolean;
  startHour?: number;
  endHour?: number;
  /** Snap granularity for drag + empty-slot taps (календарь передаёт
   *  константные 15) — web DayColumn `snapMinutes` semantics. */
  stepMinutes?: number;
  /** Committed pixels-per-hour (post-pinch) — px math only (tap→minutes,
   *  drag snap, text fit); on-screen geometry is percent/flex. */
  hourH: number;
  /** Work band — everything outside gets the grey off-hours wash (web
   *  DayColumn out-of-hours overlays). Defaults to the visible window. */
  workStartHour?: number;
  workEndHour?: number;
  /** Per-date band from the team schedule; wins over workStartHour/EndHour.
   *  null = нерабочий день → no wash at all (web v473: day-off body stays
   *  plain); undefined → fall back to workStartHour/EndHour. */
  workBand?: WorkBand | null;
  /** РЕЖИМ ПОДБОРА ВРЕМЕНИ: зелёные кубики «сюда можно записать» прямо в
   *  сетке — поверх серого нерабочих часов, под блоками записей. Пусто/не
   *  задано — обычный календарь без подсветки. */
  freeSlots?: readonly FreeSlotRange[];
  /** Minutes reserved after each live appointment (дорога/уборка) —
   *  rendered as a subtle band under the blocks, web DayColumn.tsx:558-580.
   *  0 = off. */
  bufferMinutes?: number;
  /** Current time in minutes since midnight (business timezone), ticked
   *  by the parent every minute. Null/undefined → no now-line. */
  nowMinutes?: number | null;
  /** Day-label (city/tag) colour — washes the whole column very lightly
   *  (web DayColumn tintByLabel, Phase I41). Null/undefined → no tint. */
  tintColor?: string | null;
};
