// Recurring reminders — service follow-ups that are NOT scheduled
// appointments yet. Every HVAC A/C cleaning comes back in 6 months; the
// dispatcher creates a reminder when the current visit completes, and
// the app surfaces it on the recurring page when the due date is close.
//
// Intentionally distinct from Waitlist. Waitlist = "client wanted a slot,
// couldn't get one, call back to offer one". Recurring = "we did the job
// X months ago, it's time to offer the next one."

// STORY-050 — recurring reminders moved to Supabase. The localStorage
// writers (`saveRecurring`, `createRecurring`, `markStatus`,
// `removeRecurring`) are gone; producers/consumers go through
// `db/repositories/recurring-reminders.ts`. We keep `loadRecurring`
// for the Settings → Опасная зона import button, plus the pure
// helpers (`addMonthsYYYYMMDD`, `dueReminders`, `pendingCount`) that
// are platform-agnostic.

export type RecurringStatus = "pending" | "booked" | "dismissed";

/** P0 #19 (CRM Core brief) — kind of follow-up the operator wants
 *  surfaced. «service» is the legacy «next A/C cleaning» reminder
 *  the table was built around; the other four power ad-hoc reminders
 *  («позвонить через неделю», «прислать каталог», custom note). */
export type RecurringType = "call" | "visit" | "sms" | "service" | "custom";

/** Channel the reminder ships through when it fires. Email path
 *  exists for the receipts/portal flow; SMS routes through the
 *  Twilio integration; push is the in-app default. */
export type RecurringChannel = "push" | "sms" | "email";

export interface RecurringReminder {
  id: string;
  client_id: string;
  /** Denormalised so deleting a client doesn't drop the reminder. */
  client_name: string;
  phone: string;
  team_id: string | null;
  service_ids: string[];
  /** Short human summary — "Чистка 2 шт + фильтр". */
  service_summary: string;
  /** YYYY-MM-DD of the visit that seeded this reminder. */
  last_date: string;
  /** YYYY-MM-DD when the follow-up should be offered. */
  next_due_date: string;
  interval_months: number;
  status: RecurringStatus;
  note: string;
  /** P0 #19 — kind of follow-up. Optional for backward-compat;
   *  Supabase column has `default 'service'` so the row is consistent
   *  even when the writer forgot to fill it. */
  type?: RecurringType;
  /** True for ad-hoc reminders the operator created from the FAB;
   *  false (default) for the auto-seeded post-visit follow-up. Drives
   *  the visual distinction in the inbox («ручное» pill). */
  manual?: boolean;
  /** Notification channel for when the due date arrives. */
  notify_channel?: RecurringChannel;
  created_at: string;
}

const STORAGE_KEY = "babun-recurring";

export function loadRecurring(): RecurringReminder[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function addMonthsYYYYMMDD(dateKey: string, months: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  // JS Date handles month overflow correctly (Jan 31 + 1 month → Mar 3),
  // so we clamp to the last valid day of the target month.
  const source = new Date(y, m - 1, d);
  const target = new Date(source.getFullYear(), source.getMonth() + months, 1);
  const lastDay = new Date(
    target.getFullYear(),
    target.getMonth() + 1,
    0
  ).getDate();
  target.setDate(Math.min(d, lastDay));
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}-${String(target.getDate()).padStart(2, "0")}`;
}

export interface CreateRecurringInput {
  client_id: string;
  client_name: string;
  phone: string;
  team_id: string | null;
  service_ids: string[];
  service_summary: string;
  last_date: string;
  interval_months: number;
  note?: string;
  /** P0 #19 (CRM Core brief) — kind of follow-up. Defaults to
   *  'service' on the DB side so callers that don't care stay
   *  backwards-compatible. */
  type?: RecurringType;
  /** True for ad-hoc reminders the operator creates from the inbox
   *  FAB; the auto-seed path on completed appointments leaves it
   *  false. */
  manual?: boolean;
  /** Notification channel. Default 'push'. */
  notify_channel?: RecurringChannel;
}

/**
 * Reminders that are within `windowDays` of their next_due_date or
 * already overdue. Sorted closest-first. Default 14 days covers "call
 * two weeks ahead" which is AirFix's stated playbook.
 */
export function dueReminders(
  list: RecurringReminder[],
  now: Date = new Date(),
  windowDays = 14
): RecurringReminder[] {
  const horizon = new Date(now);
  horizon.setDate(horizon.getDate() + windowDays);
  const horizonKey = toDateKey(horizon);
  return list
    .filter((r) => r.status === "pending" && r.next_due_date <= horizonKey)
    .sort((a, b) => a.next_due_date.localeCompare(b.next_due_date));
}

export function pendingCount(list: RecurringReminder[]): number {
  return list.filter((r) => r.status === "pending").length;
}

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
