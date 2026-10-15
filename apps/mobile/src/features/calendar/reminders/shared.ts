// What every calendar reminder group shares: the result vocabulary, the
// legacy per-appointment native id registry, owner keys and the lock-screen
// notification text.
import type { Appointment } from "@babun/shared/local/appointments";
import { getStorage } from "@babun/shared/storage";
import {
  babunNotificationRegistrySnapshot,
  type BabunNotificationDraft,
} from "@/lib/notifications";

export type ReminderResult =
  | "scheduled"
  | "deferred"
  | "capacity"
  | "denied"
  | "unavailable"
  | "past";

export type ReminderNotification = {
  when: Date;
  label: string;
  date?: string;
};

const REMINDER_IDS_KEY = "calendar.appointmentReminderIds.v1";

type ReminderIdRegistry = Record<string, string[]>;

export function readRegistry(): ReminderIdRegistry {
  return getStorage().get<ReminderIdRegistry>(REMINDER_IDS_KEY) ?? {};
}

export function writeRegistry(next: ReminderIdRegistry): void {
  getStorage().set(REMINDER_IDS_KEY, next);
}

export const manualOwnerKey = (appointmentId: string) =>
  `appointment:${appointmentId}`;
// КЛЮЧИ С АККАУНТОМ (13.10). Сверка календаря заменяет ВСЮ группу ключей
// разом, а в списке — записи только открытого аккаунта: переход на календарь
// другого аккаунта стирал пуши событий и колокольчики своего, и они молчали,
// пока человек не вернётся. У `auto:` это починили раньше — теперь у `event:`
// и `self:` то же устройство: `<группа>:<аккаунт>:<запись>`, и сверка
// заменяет только группу своего аккаунта.
export const eventOwnerKey = (tenantId: string, appointmentId: string) =>
  `event:${tenantId}:${appointmentId}`;

/** Ключи группы этой записи — любого аккаунта и старые, без аккаунта
 *  (`event:<запись>`): оба оканчиваются на `:<запись>`. */
export function ownersOf(prefix: "event:" | "self:" | "auto:", appointmentId: string): string[] {
  return [
    ...new Set(
      babunNotificationRegistrySnapshot()
        .map((item) => item.ownerKey)
        .filter((key) => key.startsWith(prefix) && key.endsWith(`:${appointmentId}`)),
    ),
  ];
}

/** Ключи первого вида (`<группа>:<запись>`, без аккаунта). Чей это аккаунт,
 *  по ключу не узнать, поэтому `only` — записи, которые сверка своего
 *  аккаунта тут же ставит под новым ключом: два звонка об одном не нужны, а
 *  пуши записей других аккаунтов звонят дальше, пока там не пройдёт сверка. */
export function legacyOwners(
  prefix: "event:" | "self:" | "auto:",
  only?: ReadonlySet<string>,
): string[] {
  return [
    ...new Set(
      babunNotificationRegistrySnapshot()
        .map((item) => item.ownerKey)
        .filter((key) => key.startsWith(prefix) && key.split(":").length === 2)
        .filter((key) => !only || only.has(key.slice(prefix.length))),
    ),
  ];
}

export function notificationDrafts(
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
