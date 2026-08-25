// useBookingSave — единственный путь СОЗДАНИЯ заявки/события.
//
// Зачем вынесено. Экран /book — 2478 строк, и до сих пор он был
// единственным местом, где заявка появляется на свет. Как только рядом
// понадобилась шторка «Записать» с карточки клиента, встал выбор:
// продублировать хвост сохранения (напоминание рекуррентного визита,
// синхронизация push-напоминаний события, тексты тостов, хаптика) или
// вынести его. Дубль здесь опаснее обычного: разъезжаются не пиксели, а
// побочные эффекты — заявка создалась бы, а напоминание осталось висеть
// в списке, и заметили бы это через неделю.
//
// Что ВНУТРИ: только то, что происходит ПОСЛЕ того, как черновик собран
// и признан валидным, — сама мутация и её побочные эффекты.
// Что СНАРУЖИ: сбор патча и валидация (пересечения, буферы, предоплата)
// остаются на вызывающем экране — они завязаны на его состояние.
//
// Поведение перенесено дословно из app/book/index.tsx (save), включая
// порядок тостов и то, какие сбои НЕ роняют создание.

import { useCallback } from "react";
import {
  createBlankAppointment,
  type Appointment,
} from "@babun/shared/local/appointments";
import { useToast } from "@/components/ui/Toast";
import { useCreateAppointment } from "@/features/calendar/mutations";
import { useUpdateReminderStatus } from "@/features/recurring/queries";
import { syncEventAppointmentReminders } from "@/features/calendar/reminders";
import { haptics } from "@/lib/haptics";

export interface BookingSaveInput {
  /** Готовый патч заявки (собирает вызывающий экран). */
  patch: Partial<Appointment>;
  kind: "work" | "event";
  /** Рекуррентное напоминание, из которого выросла заявка — закрываем его. */
  reminderId?: string | null;
  /** Смещение push-напоминания события; null — напоминание не ставим. */
  eventReminderOffset?: number | null;
  /** Таймзона для расчёта момента напоминания. */
  timezone: string;
}

export function useBookingSave() {
  const createMut = useCreateAppointment();
  const updateReminderStatus = useUpdateReminderStatus();
  const toast = useToast();

  const save = useCallback(
    async ({
      patch,
      kind,
      reminderId,
      eventReminderOffset,
      timezone,
    }: BookingSaveInput): Promise<Appointment> => {
      const created = await createMut.mutateAsync(
        createBlankAppointment(patch),
      );

      let reminderUpdateFailed = false;
      if (kind === "work" && reminderId) {
        try {
          await updateReminderStatus.mutateAsync({
            id: reminderId,
            status: "booked",
          });
        } catch {
          // Заявка уже создана. Не бросаем в ветку ошибки создания — иначе
          // экран останется открытым и пригласит создать дубль. Честно
          // сообщаем про оставшуюся ручную работу.
          reminderUpdateFailed = true;
        }
      }

      if (kind === "event" && eventReminderOffset != null) {
        const reminderResult = await syncEventAppointmentReminders(
          created,
          timezone,
        );
        if (reminderResult === "denied") {
          toast("Событие создано, но уведомления запрещены в Настройках", "info");
        } else if (reminderResult === "deferred") {
          toast(
            "Событие создано; напоминание стоит в очереди и установится, когда на iPhone освободится место",
            "info",
          );
        } else if (reminderResult === "capacity") {
          toast("Событие создано, но очередь напоминаний переполнена", "info");
        } else if (reminderResult === "unavailable") {
          toast(
            "Событие создано; напоминание появится после обновления приложения",
            "info",
          );
        } else if (reminderResult === "past") {
          toast("Событие создано; выбранное время напоминания уже прошло", "info");
        } else {
          toast("Событие создано с напоминанием");
        }
      } else {
        toast(
          kind === "event"
            ? "Событие создано"
            : reminderUpdateFailed
              ? "Запись создана, но напоминание осталось в списке — отметьте его вручную"
              : "Запись создана",
          reminderUpdateFailed ? "info" : "success",
        );
      }

      haptics.success();
      return created;
    },
    [createMut, updateReminderStatus, toast],
  );

  return {
    save,
    isPending: createMut.isPending || updateReminderStatus.isPending,
  };
}
