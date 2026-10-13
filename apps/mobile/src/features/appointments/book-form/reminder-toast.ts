import type { setSelfReminder } from "@/features/calendar/reminders";
import {
  selfReminderLabel,
  type SelfReminder,
} from "@/features/calendar/reminder-time";
import type { useToast } from "@/components/ui/Toast";

type Toast = ReturnType<typeof useToast>;

// Итог постановки пуша — одной строкой, теми же словами, что меню записи.
export const reminderToast = (
  toast: Toast,
  res: Awaited<ReturnType<typeof setSelfReminder>>,
  rule: SelfReminder | null,
) => {
  if (res === "cleared") toast("Напоминание снято", "info");
  else if (res === "scheduled" && rule) {
    const l = selfReminderLabel(rule);
    toast(`Напомню ${l.charAt(0).toLowerCase()}${l.slice(1)}`);
  } else if (res === "denied") toast("Разрешите уведомления в Настройках", "error");
  else if (res === "past") toast("Это время уже прошло", "info");
  else if (res === "deferred")
    toast("Напоминание в очереди — установится, когда на iPhone освободится место", "info");
  else if (res === "capacity")
    toast("Очередь напоминаний переполнена", "error");
  else if (res === "unavailable") toast("Появится после обновления приложения", "info");
};
