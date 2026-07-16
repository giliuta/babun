import type { Appointment } from "@babun/shared/local/appointments";

// expo-notifications — нативный модуль, добавленный ПОСЛЕ текущих dev-билдов:
// статический import валил бы приложение на старте (см. образец expo-contacts
// в clients/[id].tsx). Guarded require: на старых билдах Notifications = null
// и планирование отвечает "unavailable" — вызывающий показывает «появится
// после обновления».
let Notifications: typeof import("expo-notifications") | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Notifications = require("expo-notifications");
} catch {
  Notifications = null;
}

export type ReminderResult = "scheduled" | "denied" | "unavailable" | "past";

// Локальное напоминание о записи. Ограничение v1 — fire-and-forget: расписали
// и забыли, реестра notificationId ↔ apt.id нет, поэтому отмена/перенос записи
// НЕ отменяет уже назначенное напоминание — следующая итерация. Обработчик
// показа в форграунде глобально не настраиваем: для расписания на будущее
// время достаточно системного показа.
export async function scheduleAppointmentReminder(
  apt: Appointment,
  when: Date,
  label: string,
  clientName?: string,
): Promise<ReminderResult> {
  if (!Notifications) return "unavailable";
  if (when.getTime() <= Date.now()) return "past";
  try {
    // iOS спрашивает разрешение при первом вызове; повторные вызовы после
    // отказа мгновенно возвращают denied — системный диалог не зацикливается.
    const perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) return "denied";
    // Тело: кто/что + адрес — то, что нужно увидеть на локскрине, чтобы
    // понять, куда ехать, не открывая приложение.
    const who = (clientName ?? "").trim() || apt.comment.trim();
    const body = [who, apt.address.trim()].filter(Boolean).join("\n");
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `Запись ${apt.time_start}`,
        // «За 30 минут» / «Накануне в 20:00» — подзаголовок объясняет,
        // почему уведомление пришло именно сейчас.
        subtitle: label,
        ...(body ? { body } : {}),
        sound: "default",
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: when,
      },
    });
    return "scheduled";
  } catch {
    // JS-модуль есть, а нативный метод упал (промежуточный билд) — для
    // пользователя это то же «появится после обновления».
    return "unavailable";
  }
}
