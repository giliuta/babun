import type { Client } from "@babun/shared/local/clients";
import { getStorage } from "@babun/shared/storage";
import {
  getNotificationsModule,
  removeBabunNotificationOwners,
  replaceBabunNotificationOwner,
} from "@/lib/notifications";
import { clockParts } from "@/features/cabinet/notification-prefs";
import { readTeamNotifyPrefs } from "@/features/cabinet/notification-prefs-cache";

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
  /** Время из «Уведомлений» (03.10); по умолчанию — 09:00, как было. */
  time = "09:00",
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
  const { hour, minute } = clockParts(time);
  const fireAt = new Date(year, monthIndex, day, hour, minute, 0, 0);
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

// ЧТО ЭТОТ ТЕЛЕФОН ОБЕЩАЛ НАПОМНИТЬ (проверка системы 03.10). Смена времени
// «О клиентах» пересобирала всю группу `client:` по списку клиентов
// открытого аккаунта — и стирала напоминания по клиентам другого аккаунта, а
// пока список грузился, пустым списком — все. Теперь пересобирается ровно то,
// что ставили здесь: запись хранит имя, номер, дату и команду клиента.
const CLIENT_REMINDER_WANT_KEY = "babun:clients.reminderWanted.v1";

type WantedReminder = { reminderAt: string; teamId: string | null; name: string; phone: string };

function readWanted(): Record<string, WantedReminder> {
  return getStorage().get<Record<string, WantedReminder>>(CLIENT_REMINDER_WANT_KEY) ?? {};
}

function writeWanted(next: Record<string, WantedReminder>): void {
  getStorage().set(CLIENT_REMINDER_WANT_KEY, next);
}

function forgetWanted(clientId: string): void {
  const all = readWanted();
  if (!(clientId in all)) return;
  const next = { ...all };
  delete next[clientId];
  writeWanted(next);
}

type ReminderClient = Pick<Client, "id" | "full_name" | "phone" | "reminder_at" | "deleted_at" | "team_id">;

async function scheduleClientReminder(
  client: { id: string; name: string; phone: string; reminderAt: string },
  fireAt: Date,
  time: string,
  requestPermission: boolean,
): Promise<ClientReminderResult> {
  try {
    const registry = readRegistry();
    const previous = registry[client.id];
    const result = await replaceBabunNotificationOwner(
      clientOwnerKey(client.id),
      [
        {
          logicalId: `${clientOwnerKey(client.id)}:${client.reminderAt}:${time}`,
          fireAt,
          content: {
            title: "Напоминание о клиенте",
            body: [client.name.trim() || "Клиент", client.phone.trim()].filter(Boolean).join(" · "),
            sound: "default",
            data: {
              type: "client-reminder",
              clientId: client.id,
            },
          },
        },
      ],
      {
        requestPermission,
        legacyIds: previous?.notificationId ? [previous.notificationId] : [],
      },
    );
    const next = { ...readRegistry() };
    const notificationId = result.identifiers[0];
    if (notificationId) next[client.id] = { notificationId, reminderAt: client.reminderAt };
    else delete next[client.id];
    writeRegistry(next);
    return result.status;
  } catch {
    // Desired logical data stays in the common registry and is retried on the
    // next authenticated launch; stale native ids were already retired.
    return "unavailable";
  }
}

/** Turn the persisted client follow-up date into a real iOS notification.
 * The server update stays authoritative; a native failure is returned to the
 * caller so the UI can say that the date was saved but the alert was not. */
export async function syncClientReminder(client: ReminderClient): Promise<ClientReminderResult> {
  const reminderAt = client.reminder_at?.trim() ?? "";
  if (!reminderAt || client.deleted_at) {
    forgetWanted(client.id);
    await cancelClientReminder(client.id);
    return "cleared";
  }
  writeWanted({
    ...readWanted(),
    [client.id]: {
      reminderAt,
      teamId: client.team_id ?? null,
      name: client.full_name,
      phone: client.phone,
    },
  });
  // «О клиентах: Не напоминать» в команде клиента (Кабинет → Уведомления) —
  // дата сохраняется (и обещание помнится), а телефон молчит.
  const time = readTeamNotifyPrefs(client.team_id).clientTime;
  if (!time) {
    await cancelClientReminder(client.id);
    return "cleared";
  }
  const fireAt = clientReminderFireDate(reminderAt, new Date(), time);
  if (!fireAt) {
    forgetWanted(client.id);
    await cancelClientReminder(client.id);
    return "past";
  }
  return scheduleClientReminder(
    { id: client.id, name: client.full_name, phone: client.phone, reminderAt },
    fireAt,
    time,
    true,
  );
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

/** ПЕРЕСОБРАТЬ НАПОМИНАНИЯ О КЛИЕНТАХ ЭТОГО ТЕЛЕФОНА (Кабинет → Уведомления,
 *  03.10): сменили время или выключили в команде — каждое обещанное здесь
 *  напоминание встаёт на новое время или замолкает. Чужие и других аккаунтов
 *  не трогаются; разрешение iOS не спрашивается. */
export async function reconcileClientReminders(): Promise<void> {
  const now = new Date();
  for (const [clientId, want] of Object.entries(readWanted())) {
    const time = readTeamNotifyPrefs(want.teamId).clientTime;
    if (!time) {
      await cancelClientReminder(clientId);
      continue;
    }
    const fireAt = clientReminderFireDate(want.reminderAt, now, time);
    if (!fireAt) {
      forgetWanted(clientId);
      await cancelClientReminder(clientId);
      continue;
    }
    await scheduleClientReminder(
      { id: clientId, name: want.name, phone: want.phone, reminderAt: want.reminderAt },
      fireAt,
      time,
      false,
    );
  }
}
