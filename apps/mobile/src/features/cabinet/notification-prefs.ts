import {
  SELF_REMINDER_PRESETS,
  sameSelfReminder,
  selfReminderLabel,
  type SelfReminder,
} from "@/features/calendar/reminder-time";

// НАСТРОЙКИ УВЕДОМЛЕНИЙ ЭТОГО ТЕЛЕФОНА (владелец 03.10: «страница
// уведомления, то есть настройки уведомлений»).
//
// Все напоминания Babun — локальные: их ставит этот iPhone, сервер пушей на
// телефон пока не шлёт. Поэтому и настройки живут здесь, а не в аккаунте:
// на втором телефоне свои.
//   • «О записях» — автоматическое напоминание о КАЖДОЙ записи календарей,
//     которые видит человек (по умолчанию выключено). Ручной колокольчик
//     записи главнее: у такой записи звонит он, а не общее правило.
//   • «О клиентах» — во сколько звенит «Напомнить» о клиенте (было зашито
//     09:00) или не звенит вовсе.
//   • «Бюджет категорий» — сообщать ли, что расходы подошли к бюджету.
//
// Лист без React и хранилища — правила под тестом.

export interface NotificationPrefs {
  /** Напоминание о каждой записи; `null` — не напоминать. */
  records: SelfReminder | null;
  /** Время напоминания о клиенте «ЧЧ:ММ»; `null` — не напоминать. */
  clientTime: string | null;
  /** Сообщать о бюджетах категорий. */
  budget: boolean;
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  records: null,
  clientTime: "09:00",
  budget: true,
};

/** Варианты «О записях»: «Не напоминать» и готовые правила колокольчика. */
export const RECORD_REMINDER_OPTIONS: readonly (SelfReminder | null)[] = [null, ...SELF_REMINDER_PRESETS];

/** Варианты «О клиентах». */
export const CLIENT_TIME_OPTIONS: readonly (string | null)[] = [null, "08:00", "09:00", "10:00", "12:00", "18:00", "20:00"];

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function isRule(value: unknown): value is SelfReminder {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.kind === "before") return typeof v.minutes === "number" && v.minutes > 0;
  if (v.kind === "dayAt") {
    return typeof v.daysBefore === "number" && v.daysBefore >= 0 && typeof v.time === "string" && TIME_RE.test(v.time);
  }
  return false;
}

/** Сохранённое на телефоне → настройки; битое поле — умолчание. */
export function normalizeNotificationPrefs(raw: unknown): NotificationPrefs {
  const v = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    records: isRule(v.records) ? v.records : null,
    clientTime:
      v.clientTime === null
        ? null
        : typeof v.clientTime === "string" && TIME_RE.test(v.clientTime)
          ? v.clientTime
          : DEFAULT_NOTIFICATION_PREFS.clientTime,
    budget: typeof v.budget === "boolean" ? v.budget : DEFAULT_NOTIFICATION_PREFS.budget,
  };
}

export function recordsLabel(rule: SelfReminder | null): string {
  return rule ? selfReminderLabel(rule) : "Не напоминать";
}

export function clientTimeLabel(time: string | null): string {
  return time ? `В ${time}` : "Не напоминать";
}

export function sameRecordRule(a: SelfReminder | null, b: SelfReminder | null): boolean {
  return sameSelfReminder(a, b);
}

/** Часы и минуты «ЧЧ:ММ»; битое — 09:00. */
export function clockParts(time: string | null | undefined): { hour: number; minute: number } {
  const m = /^(\d{2}):(\d{2})$/.exec(time ?? "");
  if (!m) return { hour: 9, minute: 0 };
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

/** Горизонт автонапоминаний о записях: две недели вперёд. Дальше iPhone всё
 *  равно держит только 60 ближайших, а сверка календаря идёт на каждой правке. */
export const AUTO_REMINDER_HORIZON_MS = 14 * 24 * 60 * 60 * 1000;
