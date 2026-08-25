import type { Appointment } from "@babun/shared/local/appointments";
import { getStorage } from "@babun/shared/storage";
import { eventReminderOccurrences } from "@/features/calendar/reminder-time";
import {
  getNotificationsModule,
  removeBabunNotificationOwners,
  replaceBabunNotificationOwner,
  replaceBabunNotificationScope,
  type BabunNotificationDraft,
  type BabunNotificationOwnerDrafts,
} from "@/lib/notifications";

// expo-notifications — нативный модуль, добавленный после первых dev-билдов.
// The shared guarded loader keeps those builds launchable and returns null
// until a current native binary is installed.
const Notifications = getNotificationsModule();

export type ReminderResult =
  | "scheduled"
  | "deferred"
  | "capacity"
  | "denied"
  | "unavailable"
  | "past";

export interface AppointmentNotificationTarget {
  appointmentId: string;
  date: string;
  teamId?: string;
}

type ReminderNotification = {
  when: Date;
  label: string;
  date?: string;
};

const REMINDER_IDS_KEY = "calendar.appointmentReminderIds.v1";

type ReminderIdRegistry = Record<string, string[]>;

function readRegistry(): ReminderIdRegistry {
  return getStorage().get<ReminderIdRegistry>(REMINDER_IDS_KEY) ?? {};
}

function writeRegistry(next: ReminderIdRegistry): void {
  getStorage().set(REMINDER_IDS_KEY, next);
}

const manualOwnerKey = (appointmentId: string) =>
  `appointment:${appointmentId}`;
const eventOwnerKey = (appointmentId: string) => `event:${appointmentId}`;

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

function notificationDrafts(
  apt: Appointment,
  reminders: readonly ReminderNotification[],
  clientName?: string,
  ownerKey = manualOwnerKey(apt.id),
): BabunNotificationDraft[] {
  // Тело: кто/что + адрес — то, что нужно увидеть на локскрине, чтобы
  // понять, куда ехать, не открывая приложение.
  const who = (clientName ?? "").trim() || apt.comment.trim();
  const body = [who, apt.address.trim()].filter(Boolean).join("\n");
  return reminders.map((reminder) => ({
    logicalId: [
      ownerKey,
      reminder.when.toISOString(),
      reminder.date ?? apt.date,
      reminder.label,
    ].join(":"),
    fireAt: reminder.when,
    content: {
      title: `${apt.kind === "event" || apt.kind === "personal" ? "Событие" : "Запись"} ${apt.time_start}`,
      // Подзаголовок объясняет, почему уведомление пришло сейчас.
      subtitle: reminder.label,
      ...(body ? { body } : {}),
      sound: "default",
      // The response handler validates this payload, waits for an
      // authenticated session, and then lets the role-filtered calendar
      // query resolve the record. A guessed id never bypasses access.
      data: {
        type: "calendar-appointment",
        appointmentId: apt.id,
        date: reminder.date ?? apt.date,
        teamId: apt.team_id,
      },
    },
  }));
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
