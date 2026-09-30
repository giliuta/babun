import { countWordRu } from "@babun/shared/common/utils/pluralize";

import { parseAppointmentNotificationTarget } from "@/features/calendar/reminders";
import { parseClientNotificationTarget } from "@/features/clients/reminders";

import { clockTime, dayMonth, localDayKey, weekdayName } from "./when";

// «УВЕДОМЛЕНИЯ» В КАБИНЕТЕ — КАК СТРАНИЦА ЧИТАЕТ НАПОМИНАНИЯ ЭТОГО ТЕЛЕФОНА
// (владелец 2026-09-15: «три строки — полная хуетень… максимально удобно и
// информативно»; разрез 007 + 008: страница и строка-дверь — 008).
//
// Лист чистый: записи реестра `lib/notifications.ts` → строки страницы и подпись
// строки-двери. Нативного модуля и хранилища здесь нет — решение целиком под
// тестом.
//
// ТРИ ИСТОЧНИКА, И У КАЖДОГО СВОЯ ПРАВДА:
//   • `appointment:` — ручное «Напомнить» из записи. Живёт только на этом
//     телефоне, пересоздать его некому, поэтому отмена отсюда честная;
//   • `event:` — напоминание события из базы (`event_push_enabled`). Сверка
//     календаря ставит его заново на каждой загрузке: отмена отсюда вернулась
//     бы сама. Строка открывает событие — выключают там;
//   • `client:` — «Напомнить о клиенте» с датой в карточке (`reminder_at`,
//     истина на сервере). Строка открывает карточку клиента.
// Кнопки «Отменить все» нет по той же причине: половина вернулась бы сама.
//
// ОДНА СТРОКА НА ИСТОЧНИК, А НЕ НА СРАБАТЫВАНИЕ. У повторяющегося события в
// реестре лежит отрезок будущих срабатываний, и перечень из пяти дат врал бы,
// что их пять (DS: «правило не показывают экземплярами»). Строка называет
// ближайшее.

/** Запись реестра в том виде, в каком её отдаёт `lib/notifications.ts`. */
export interface DeviceReminder {
  logicalId: string;
  ownerKey: string;
  fireAt: number;
  title: string | null;
  subtitle: string | null;
  body: string | null;
  data: Record<string, unknown>;
}

export type ReminderSource =
  | { kind: "appointment"; appointmentId: string; date: string; teamId?: string }
  | { kind: "event"; appointmentId: string; date: string; teamId?: string }
  | { kind: "client"; clientId: string }
  | { kind: "other" };

export interface ReminderRow {
  /** Ключ источника: одна строка на запись, событие или клиента. */
  key: string;
  fireAt: number;
  /** «09:30» — когда телефон зазвонит, по его часам. */
  time: string;
  title: string;
  sub: string;
  source: ReminderSource;
}

export interface ReminderDay {
  key: string;
  /** «Сегодня» · «Завтра» · «Пятница, 19 сентября». */
  title: string;
  rows: ReminderRow[];
}

export type DevicePermission =
  | "granted"
  | "denied"
  | "undetermined"
  | "unavailable";

/** Полезная нагрузка уведомления проверяется теми же разборщиками, что и тап
 *  по баннеру: чужой или битый payload не превращается в дверь. */
export function reminderSource(
  reminder: Pick<DeviceReminder, "ownerKey" | "data">,
): ReminderSource {
  const prefix = reminder.ownerKey.split(":", 1)[0];
  if (prefix === "appointment" || prefix === "event") {
    const target = parseAppointmentNotificationTarget(reminder.data);
    if (!target) return { kind: "other" };
    return prefix === "appointment"
      ? { kind: "appointment", ...target }
      : { kind: "event", ...target };
  }
  if (prefix === "client") {
    const target = parseClientNotificationTarget(reminder.data);
    return target ? { kind: "client", ...target } : { kind: "other" };
  }
  return { kind: "other" };
}

/** Отменить отсюда можно ТОЛЬКО ручное напоминание записи. Событие и клиента
 *  пересоздаст база — их строка открывает свой источник. */
export function reminderCanCancel(source: ReminderSource): boolean {
  return source.kind === "appointment";
}

const lowerFirst = (value: string) =>
  value ? value.charAt(0).toLowerCase() + value.slice(1) : value;

export function reminderRow(reminder: DeviceReminder): ReminderRow {
  const source = reminderSource(reminder);
  const title = reminder.title?.trim() ?? "";
  const label = reminder.subtitle?.trim() ?? "";
  let rowTitle: string;
  let sub: string;
  if (source.kind === "client") {
    // Тело клиентского напоминания — «Имя · телефон»; строку читают ради имени.
    rowTitle = (reminder.body ?? "").split(" · ")[0]?.trim() || "Клиент";
    sub = title || "Напоминание о клиенте";
  } else {
    // Тело записи — «кто\nадрес» (тот же текст, что на локскрине). Кто — имя
    // строки; «Запись 10:00 · за 30 минут» — её подпись.
    const who = (reminder.body ?? "").split("\n")[0]?.trim() ?? "";
    if (who) {
      rowTitle = who;
      sub = [title, lowerFirst(label)].filter(Boolean).join(" · ");
    } else {
      rowTitle = title || "Напоминание";
      sub = label;
    }
  }
  return {
    key: reminder.ownerKey,
    fireAt: reminder.fireAt,
    time: clockTime(reminder.fireAt),
    title: rowTitle,
    sub,
    source,
  };
}

function reminderDayTitle(fireAt: number, now: number): string {
  const today = new Date(now);
  const tomorrow = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() + 1,
  ).getTime();
  const key = localDayKey(fireAt);
  if (key === localDayKey(now)) return "Сегодня";
  if (key === localDayKey(tomorrow)) return "Завтра";
  return `${weekdayName(fireAt)}, ${dayMonth(fireAt, now)}`;
}

/** Будущие напоминания: ближайшее у каждого источника, по времени, по дням. */
export function reminderDays(
  reminders: readonly DeviceReminder[],
  now: number,
): ReminderDay[] {
  const nearest = new Map<string, DeviceReminder>();
  for (const reminder of reminders) {
    if (!(reminder.fireAt > now)) continue;
    const kept = nearest.get(reminder.ownerKey);
    if (!kept || reminder.fireAt < kept.fireAt) {
      nearest.set(reminder.ownerKey, reminder);
    }
  }
  const rows = [...nearest.values()]
    .sort((a, b) => a.fireAt - b.fireAt || a.ownerKey.localeCompare(b.ownerKey))
    .map(reminderRow);
  const days: ReminderDay[] = [];
  for (const row of rows) {
    const key = localDayKey(row.fireAt);
    const last = days[days.length - 1];
    if (last && last.key === key) last.rows.push(row);
    else days.push({ key, title: reminderDayTitle(row.fireAt, now), rows: [row] });
  }
  return days;
}

export function reminderCount(days: readonly ReminderDay[]): number {
  return days.reduce((total, day) => total + day.rows.length, 0);
}

/** Ответ `getPermissionsAsync`. `null` — нативного модуля в сборке нет. */
export function devicePermissionFrom(
  permission: { granted?: boolean; status?: string } | null | undefined,
): DevicePermission {
  if (!permission) return "unavailable";
  if (permission.granted) return "granted";
  return permission.status === "denied" ? "denied" : "undetermined";
}

/** Напоминания есть, а зазвонить им не дадут — единственное состояние, ради
 *  которого подпись красится янтарём (закон `SettingsRow.subColor`). */
export function remindersSilenced(
  permission: DevicePermission,
  count: number,
): boolean {
  return count > 0 && (permission === "denied" || permission === "undetermined");
}

/** Подпись строки-двери в Кабинете: «Разрешены · 3 напоминания». */
export function notificationsSummary(
  permission: DevicePermission,
  count: number,
): string {
  if (permission === "unavailable") return "Недоступны в этой сборке";
  const state =
    permission === "granted"
      ? "Разрешены"
      : permission === "denied"
        ? "Выключены"
        : "Не разрешены";
  if (count === 0) return state;
  return `${state} · ${count} ${countWordRu(count, "напоминание", "напоминания", "напоминаний")}`;
}

export interface PermissionRowView {
  sub: string;
  /** `request` — системный вопрос iOS (задаётся один раз); `settings` —
   *  настройки iPhone: после отказа приложение спросить уже не может. */
  action: "request" | "settings" | null;
}

export function permissionRow(permission: DevicePermission): PermissionRowView {
  switch (permission) {
    case "granted":
      return { sub: "Разрешены", action: "settings" };
    case "denied":
      return { sub: "Выключены в настройках iPhone", action: "settings" };
    case "undetermined":
      return { sub: "Не разрешены", action: "request" };
    case "unavailable":
      return { sub: "Появятся после обновления приложения", action: null };
  }
}
