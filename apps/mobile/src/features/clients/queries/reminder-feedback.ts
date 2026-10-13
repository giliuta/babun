import { Linking } from "react-native";
import type { Client } from "@babun/shared/local/clients";
import { confirmThen } from "@/lib/confirm";
import { notify } from "@/lib/notify";
import {
  syncClientReminder,
  type ClientReminderResult,
} from "@/features/clients/reminders";

function surfaceClientReminderResult(result: ClientReminderResult): void {
  if (result === "scheduled" || result === "cleared") return;
  if (result === "denied") {
    confirmThen(
      "Дата сохранена",
      {
        message: "Уведомление не запланировано, потому что оно выключено для Babun в настройках iPhone.",
        confirmLabel: "Открыть настройки",
      },
      () => void Linking.openSettings(),
    );
    return;
  }
  if (result === "deferred") {
    notify(
      "Дата сохранена",
      "Напоминание сохранено в очереди и установится, когда на iPhone освободится место.",
    );
    return;
  }
  if (result === "capacity") {
    notify(
      "Дата сохранена",
      "Очередь напоминаний переполнена. Удалите ненужные напоминания и сохраните дату ещё раз.",
    );
    return;
  }
  notify(
    "Дата сохранена",
    result === "past"
      ? "Эта дата уже прошла, поэтому системное уведомление не создавалось."
      : "Системное уведомление не удалось создать. Обновите приложение и повторите попытку.",
  );
}

export function syncClientReminderWithFeedback(client: Client): void {
  void syncClientReminder(client).then(surfaceClientReminderResult);
}
