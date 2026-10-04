import {
  SELF_REMINDER_PRESETS,
  sameSelfReminder,
  selfReminderLabel,
  type SelfReminder,
} from "@/features/calendar/reminder-time";
import { changeSubject, changeTitle, type ChangeLogRow } from "./change-log";

// УВЕДОМЛЕНИЯ — НА КАЖДУЮ КОМАНДУ (владелец 03.10: «когда добавляется новая
// команда, мы настраиваем уведомления чётко на эту команду, вот и всё»).
//
// Настройки человека в команде — строка `team_notification_prefs` (у каждого
// свои, одни на всех его телефонах):
//   • «О записях» — напоминание о каждой записи команды (по умолчанию нет);
//   • «О клиентах» — во сколько звенит «Напомнить» о клиенте команды;
//   • «Что происходит» — новые записи, переносы и изменения, отмены, оплаты,
//     сделанные ДРУГИМИ (свои действия не присылаются): телефон читает их из
//     истории изменений;
//   • «Бюджет категорий» команды.
// Строки нет — умолчания (`DEFAULT_TEAM_PREFS`, те же, что у столбцов базы).
//
// Лист без React и хранилища — правила под тестом.

export interface TeamNotifyPrefs {
  /** Напоминание о каждой записи; `null` — не напоминать. */
  records: SelfReminder | null;
  /** Время напоминания о клиенте «ЧЧ:ММ»; `null` — не напоминать. */
  clientTime: string | null;
  notifyNew: boolean;
  notifyChange: boolean;
  notifyCancel: boolean;
  notifyPayment: boolean;
  budget: boolean;
}

export const DEFAULT_TEAM_PREFS: TeamNotifyPrefs = {
  records: null,
  clientTime: "09:00",
  notifyNew: true,
  notifyChange: true,
  notifyCancel: true,
  notifyPayment: false,
  budget: true,
};

/** Строка базы `team_notification_prefs`. */
export interface TeamNotifyRow {
  tenant_id: string;
  team_id: string;
  record_reminder: unknown;
  client_reminder_time: string | null;
  notify_new: boolean;
  notify_change: boolean;
  notify_cancel: boolean;
  notify_payment: boolean;
  budget: boolean;
}

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

const bool = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);

/** Строка базы (или кэш телефона) → настройки; битое поле — умолчание. */
export function prefsFromRow(row: Partial<TeamNotifyRow> | null | undefined): TeamNotifyPrefs {
  if (!row) return DEFAULT_TEAM_PREFS;
  return {
    records: isRule(row.record_reminder) ? row.record_reminder : null,
    clientTime:
      row.client_reminder_time === null
        ? null
        : typeof row.client_reminder_time === "string" && TIME_RE.test(row.client_reminder_time)
          ? row.client_reminder_time
          : DEFAULT_TEAM_PREFS.clientTime,
    notifyNew: bool(row.notify_new, DEFAULT_TEAM_PREFS.notifyNew),
    notifyChange: bool(row.notify_change, DEFAULT_TEAM_PREFS.notifyChange),
    notifyCancel: bool(row.notify_cancel, DEFAULT_TEAM_PREFS.notifyCancel),
    notifyPayment: bool(row.notify_payment, DEFAULT_TEAM_PREFS.notifyPayment),
    budget: bool(row.budget, DEFAULT_TEAM_PREFS.budget),
  };
}

/** Настройки → столбцы строки базы. */
export function rowFromPrefs(
  prefs: TeamNotifyPrefs,
): Omit<TeamNotifyRow, "tenant_id" | "team_id" | "record_reminder"> & { record_reminder: SelfReminder | null } {
  return {
    record_reminder: prefs.records,
    client_reminder_time: prefs.clientTime,
    notify_new: prefs.notifyNew,
    notify_change: prefs.notifyChange,
    notify_cancel: prefs.notifyCancel,
    notify_payment: prefs.notifyPayment,
    budget: prefs.budget,
  };
}

/** Варианты «О записях»: «Не напоминать» и готовые правила колокольчика. */
export const RECORD_REMINDER_OPTIONS: readonly (SelfReminder | null)[] = [null, ...SELF_REMINDER_PRESETS];

/** Варианты «О клиентах». */
export const CLIENT_TIME_OPTIONS: readonly (string | null)[] = [null, "08:00", "09:00", "10:00", "12:00", "18:00", "20:00"];

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

// ── ЧТО ПРОИСХОДИТ В КОМАНДЕ ─────────────────────────────────────────────

export type ActivityKind = "new" | "change" | "cancel" | "payment";

const PAYMENT_FIELDS = new Set([
  "payments",
  "payment",
  "paid_amount",
  "payment_status",
  "payment_method",
  "payment_account_id",
  "prepayments",
  "prepaid_amount",
]);

/** Какое это событие для уведомлений, или `null` — не о чем сообщать.
 *  Только записи (не личные события) и входящие деньги. */
export function activityKind(row: Pick<ChangeLogRow, "entity" | "action" | "meta" | "changes">): ActivityKind | null {
  if (row.entity === "finance_transactions") {
    return row.action === "insert" && row.meta?.type === "income" ? "payment" : null;
  }
  if (row.entity !== "appointments") return null;
  if (row.meta?.kind === "event" || row.meta?.kind === "personal") return null;
  if (row.action === "insert") return "new";
  if (row.action === "delete") return "cancel";
  if (row.action !== "update") return null;
  const changes = row.changes ?? {};
  const status = changes.status;
  if (Array.isArray(status) && status[1] === "cancelled") return "cancel";
  const fields = Object.keys(changes);
  if (fields.length > 0 && fields.every((f) => PAYMENT_FIELDS.has(f))) return "payment";
  return "change";
}

/** Сообщать ли человеку `me` об этой строке журнала. Свои действия — нет. */
export function shouldNotify(
  row: Pick<ChangeLogRow, "entity" | "action" | "meta" | "changes" | "actor_id">,
  prefs: TeamNotifyPrefs,
  me: string | null,
): boolean {
  if (!me || row.actor_id === me) return false;
  switch (activityKind(row)) {
    case "new":
      return prefs.notifyNew;
    case "change":
      return prefs.notifyChange;
    case "cancel":
      return prefs.notifyCancel;
    case "payment":
      return prefs.notifyPayment;
    default:
      return false;
  }
}

/** Текст уведомления: «Запись создана · Y&D» / «Анастасия · 4 окт, 14:00 — Иван». */
export function activityNotification(
  row: ChangeLogRow,
  teamName: string | null,
  actorName: string | null,
): { title: string; body: string } {
  const title = [changeTitle(row), teamName].filter(Boolean).join(" · ");
  const subject = changeSubject(row);
  const body = [subject, actorName].filter(Boolean).join(" — ");
  return { title, body };
}
