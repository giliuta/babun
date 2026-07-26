import type { Client } from "@babun/shared/local/clients";
import { getStorage } from "@babun/shared/storage";
import {
  getNotificationsModule,
  removeBabunNotificationOwners,
  replaceBabunNotificationOwner,
} from "@/lib/notifications";

const Notifications = getNotificationsModule();

const CLIENT_REMINDER_IDS_KEY = "babun:clients.reminderNotificationIds.v1";

type ReminderRegistry = Record<
  string,
  { notificationId: string; reminderAt: string }
>;

export type ClientReminderResult =
  | "scheduled"
  | "deferred"
  | "capacity"
  | "cleared"
  | "denied"
  | "unavailable"
  | "past";

export interface ClientNotificationTarget {
  clientId: string;
}

function readRegistry(): ReminderRegistry {
  return getStorage().get<ReminderRegistry>(CLIENT_REMINDER_IDS_KEY) ?? {};
}

function writeRegistry(next: ReminderRegistry): void {
  getStorage().set(CLIENT_REMINDER_IDS_KEY, next);
}

const clientOwnerKey = (clientId: string) => `client:${clientId}`;

/** A date-only follow-up fires at 09:00 in the iPhone's local timezone. The
 * CRM stores YYYY-MM-DD (not an instant), and follow-ups belong to the person
 * using this device, so silently converting through UTC would shift the day
 * for Cyprus and other positive offsets. */
export function clientReminderFireDate(
  value: string,
  now: Date = new Date(),
): Date | null {
  // Приложение пишет ДАТУ («2026-08-02»), а колонка reminder_at —
  // timestamptz: после синка то же значение возвращается как
  // «2026-08-02T00:00:00+00:00». Регэксп на голую дату этого не принимал —
  // напоминание МОЛЧА отменялось, а человек получал алерт «эта дата уже
  // прошла» (format.ts этот случай уже учитывал, здесь нет). Берём
  // дата-часть: это то же календарное число, которое и выбрали.
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const fireAt = new Date(year, monthIndex, day, 9, 0, 0, 0);
  if (
    fireAt.getFullYear() !== year ||
    fireAt.getMonth() !== monthIndex ||
    fireAt.getDate() !== day ||
    fireAt.getTime() <= now.getTime()
  ) {
    return null;
  }
  return fireAt;
}

export async function cancelClientReminder(clientId: string): Promise<void> {
  const registry = readRegistry();
  const previous = registry[clientId];
  await removeBabunNotificationOwners(
    [clientOwnerKey(clientId)],
    previous?.notificationId ? [previous.notificationId] : [],
  );
  if (clientId in registry) {
    const next = { ...registry };
    delete next[clientId];
    writeRegistry(next);
  }
}

/** Turn the persisted client follow-up date into a real iOS notification.
 * The server update stays authoritative; a native failure is returned to the
 * caller so the UI can say that the date was saved but the alert was not. */
export async function syncClientReminder(
  client: Pick<
    Client,
    "id" | "full_name" | "phone" | "reminder_at" | "deleted_at"
  >,
): Promise<ClientReminderResult> {
  const reminderAt = client.reminder_at?.trim() ?? "";
  if (!reminderAt || client.deleted_at) {
    await cancelClientReminder(client.id);
    return "cleared";
  }

  const fireAt = clientReminderFireDate(reminderAt);
  if (!fireAt) {
    await cancelClientReminder(client.id);
    return "past";
  }
  try {
    const registry = readRegistry();
    const previous = registry[client.id];
    const result = await replaceBabunNotificationOwner(
      clientOwnerKey(client.id),
      [
        {
          logicalId: `${clientOwnerKey(client.id)}:${reminderAt}`,
          fireAt,
          content: {
            title: "Напоминание о клиенте",
            body: [client.full_name.trim() || "Клиент", client.phone.trim()]
              .filter(Boolean)
              .join(" · "),
            sound: "default",
            data: {
              type: "client-reminder",
              clientId: client.id,
            },
          },
        },
      ],
      {
        requestPermission: true,
        legacyIds: previous?.notificationId
          ? [previous.notificationId]
          : [],
      },
    );
    const next = { ...registry };
    const notificationId = result.identifiers[0];
    if (notificationId) next[client.id] = { notificationId, reminderAt };
    else delete next[client.id];
    writeRegistry(next);
    return result.status;
  } catch {
    // Desired logical data stays in the common registry and is retried on the
    // next authenticated launch; stale native ids were already retired.
    return "unavailable";
  }
}

export function parseClientNotificationTarget(
  data: Record<string, unknown> | null | undefined,
): ClientNotificationTarget | null {
  if (!data || data.type !== "client-reminder") return null;
  const clientId = typeof data.clientId === "string" ? data.clientId.trim() : "";
  if (!clientId || clientId.length > 128) return null;
  return { clientId };
}

export function subscribeToClientNotificationResponses(
  onTarget: (target: ClientNotificationTarget) => void,
): () => void {
  if (!Notifications) return () => {};
  const subscription = Notifications.addNotificationResponseReceivedListener(
    (response) => {
      const target = parseClientNotificationTarget(
        response.notification.request.content.data,
      );
      if (target) {
        onTarget(target);
        void Notifications.clearLastNotificationResponseAsync().catch(() => {});
      }
    },
  );
  return () => subscription.remove();
}

export async function consumeLastClientNotificationTarget(): Promise<
  ClientNotificationTarget | null
> {
  if (!Notifications) return null;
  try {
    const response = await Notifications.getLastNotificationResponseAsync();
    if (!response) return null;
    const target = parseClientNotificationTarget(
      response.notification.request.content.data,
    );
    if (target) await Notifications.clearLastNotificationResponseAsync();
    return target;
  } catch {
    return null;
  }
}
