import type { Appointment } from "@babun/shared/local/appointments";
import { eventReminderOccurrences } from "@/features/calendar/reminder-time";
import {
  getNotificationsModule,
  removeBabunNotificationOwners,
  replaceBabunNotificationOwner,
  replaceBabunNotificationScope,
  type BabunNotificationOwnerDrafts,
} from "@/lib/notifications";
import {
  eventOwnerKey,
  manualOwnerKey,
  notificationDrafts,
  readRegistry,
  writeRegistry,
  type ReminderNotification,
  type ReminderResult,
} from "./reminders/shared";

// Shared helpers and the device-local groups (`self:`, `auto:`) live in
// `./reminders/`; record and event reminders and notification taps stay here.
export type { ReminderResult } from "./reminders/shared";
export {
  clearSelfReminder,
  getSelfReminder,
  reconcileAutoReminders,
  reconcileSelfReminders,
  setSelfReminder,
} from "./reminders/own";

// expo-notifications — нативный модуль, добавленный после первых dev-билдов.
// The shared guarded loader keeps those builds launchable and returns null
// until a current native binary is installed.
const Notifications = getNotificationsModule();

export interface AppointmentNotificationTarget {
  appointmentId: string;
  date: string;
  teamId?: string;
}

/** Cancel every local notification attached to one appointment. This is
 * called when the record is moved, cancelled or deleted so an old absolute
 * notification can never fire for a slot that no longer exists. */
export async function cancelAppointmentReminders(
  appointmentId: string,
): Promise<void> {
  const registry = readRegistry();
  const ids = registry[appointmentId] ?? [];
  await removeBabunNotificationOwners(
    [manualOwnerKey(appointmentId), eventOwnerKey(appointmentId)],
    ids,
  );
  if (appointmentId in registry) {
    const next = { ...registry };
    delete next[appointmentId];
    writeRegistry(next);
  }
}

/** Снять только РУЧНОЕ напоминание записи — Кабинет → «Уведомления». Напоминание
 * события живёт в базе и вернётся сверкой календаря, поэтому его выключают в
 * самом событии, а этот вызов его не трогает. */
export async function cancelManualAppointmentReminder(
  appointmentId: string,
): Promise<void> {
  const registry = readRegistry();
  await removeBabunNotificationOwners(
    [manualOwnerKey(appointmentId)],
    registry[appointmentId] ?? [],
  );
  if (appointmentId in registry) {
    const next = { ...registry };
    delete next[appointmentId];
    writeRegistry(next);
  }
}

// Локальное напоминание о записи. Для каждой записи хранится id системного
// уведомления: новый пресет заменяет старый, а перенос/отмена/удаление снимают
// устаревшее уведомление через cancelAppointmentReminders.
export async function scheduleAppointmentReminder(
  apt: Appointment,
  when: Date,
  label: string,
  clientName?: string,
): Promise<ReminderResult> {
  return scheduleAppointmentReminders(
    apt,
    [{ when, label, date: apt.date }],
    clientName,
    manualOwnerKey(apt.id),
  );
}

async function scheduleAppointmentReminders(
  apt: Appointment,
  reminders: ReminderNotification[],
  clientName?: string,
  ownerKey = manualOwnerKey(apt.id),
): Promise<ReminderResult> {
  const future = reminders.filter((item) => item.when.getTime() > Date.now());
  if (future.length === 0) return "past";
  try {
    const registry = readRegistry();
    const previousIds = registry[apt.id] ?? [];
    const result = await replaceBabunNotificationOwner(
      ownerKey,
      notificationDrafts(apt, future, clientName, ownerKey),
      { requestPermission: true, legacyIds: previousIds },
    );
    const next = { ...registry };
    if (result.identifiers.length > 0) next[apt.id] = result.identifiers;
    else delete next[apt.id];
    writeRegistry(next);
    return result.status;
  } catch {
    // JS-модуль есть, а нативный метод упал (промежуточный билд) — для
    // пользователя это то же «появится после обновления».
    return "unavailable";
  }
}

/** Validate the untrusted JSON delivered by a notification/deep-link tap.
 * IDs stay opaque here; tenant and role authorization is performed by the
 * calendar's existing scoped query before a sheet can be shown. */
export function parseAppointmentNotificationTarget(
  data: Record<string, unknown> | null | undefined,
): AppointmentNotificationTarget | null {
  if (!data || data.type !== "calendar-appointment") return null;
  const appointmentId =
    typeof data.appointmentId === "string" ? data.appointmentId.trim() : "";
  const date = typeof data.date === "string" ? data.date.trim() : "";
  const teamId = typeof data.teamId === "string" ? data.teamId.trim() : "";
  if (
    !appointmentId ||
    appointmentId.length > 128 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    teamId.length > 128
  ) {
    return null;
  }
  return {
    appointmentId,
    date,
    ...(teamId ? { teamId } : {}),
  };
}

export function subscribeToAppointmentNotificationResponses(
  onTarget: (target: AppointmentNotificationTarget) => void,
): () => void {
  if (!Notifications) return () => {};
  const subscription = Notifications.addNotificationResponseReceivedListener(
    (response) => {
      const target = parseAppointmentNotificationTarget(
        response.notification.request.content.data,
      );
      if (target) {
        onTarget(target);
        // Clear only a handled Babun response. Unrelated notification
        // payloads belong to their own feature and must stay available.
        void Notifications!.clearLastNotificationResponseAsync().catch(() => {});
      }
    },
  );
  return () => subscription.remove();
}

/** Consume the launch response only after auth is available. Clearing it
 * prevents an old tap from reopening the same appointment on later launches. */
export async function consumeLastAppointmentNotificationTarget(): Promise<
  AppointmentNotificationTarget | null
> {
  if (!Notifications) return null;
  try {
    const response = await Notifications.getLastNotificationResponseAsync();
    if (!response) return null;
    const target = parseAppointmentNotificationTarget(
      response.notification.request.content.data,
    );
    if (target) await Notifications.clearLastNotificationResponseAsync();
    return target;
  } catch {
    return null;
  }
}

/** Reconcile persisted event reminder metadata with native notifications.
 * Infinite recurrences are bounded by eventReminderOccurrences. */
export async function syncEventAppointmentReminders(
  appointment: Appointment,
  timeZone: string,
): Promise<ReminderResult | "cleared"> {
  if (!appointment.event_push_enabled) {
    await cancelAppointmentReminders(appointment.id);
    return "cleared";
  }
  const reminders = eventReminderOccurrences(appointment, timeZone);
  if (reminders.length === 0) {
    await cancelAppointmentReminders(appointment.id);
    return "past";
  }
  return scheduleAppointmentReminders(
    appointment,
    reminders,
    undefined,
    eventOwnerKey(appointment.id),
  );
}

/** Rebuild every DB-backed event owner in one nearest-first pass. This runs
 * after the role-scoped calendar query loads and never opens the permission
 * prompt; an explicit user action remains the only prompt boundary. */
export async function reconcileEventAppointmentReminders(
  appointments: readonly Appointment[],
  timeZoneFor: (appointment: Appointment) => string,
): Promise<void> {
  const owners: BabunNotificationOwnerDrafts[] = [];
  const legacyRegistry = readRegistry();
  const eventIds = new Set<string>();
  for (const appointment of appointments) {
    if (appointment.kind !== "event" && appointment.kind !== "personal") {
      continue;
    }
    eventIds.add(appointment.id);
    if (
      !appointment.event_push_enabled ||
      appointment.status === "cancelled"
    ) {
      continue;
    }
    const ownerKey = eventOwnerKey(appointment.id);
    const reminders = eventReminderOccurrences(
      appointment,
      timeZoneFor(appointment),
    );
    if (reminders.length === 0) continue;
    owners.push({
      ownerKey,
      drafts: notificationDrafts(appointment, reminders, undefined, ownerKey),
    });
  }
  const legacyIds = [...eventIds].flatMap(
    (appointmentId) => legacyRegistry[appointmentId] ?? [],
  );
  await replaceBabunNotificationScope("event:", owners, {
    requestPermission: false,
    legacyIds,
  });
  if (legacyIds.length > 0) {
    const next = { ...legacyRegistry };
    for (const appointmentId of eventIds) delete next[appointmentId];
    writeRegistry(next);
  }
}
