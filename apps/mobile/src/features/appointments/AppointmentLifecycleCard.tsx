import { Text, View } from "react-native";
import type { Appointment } from "@babun/shared/local/appointments";
import { ActionRow } from "@/components/ui/card-rows";
import { SectionCard } from "@/components/ui/SectionCard";
import { useToast } from "@/components/ui/Toast";
import { isCalendarEvent } from "@/features/calendar/event-access";
import { useDeleteAppointment, useUpdateAppointment } from "@/features/calendar/mutations";
import { cancelAppointmentReminders } from "@/features/calendar/reminders";
import { useCurrentRole } from "@/features/settings/tenant";
import { chooseOption } from "@/lib/choose";
import { confirmAction } from "@/lib/confirm";
import { haptics } from "@/lib/haptics";
import { notify } from "@/lib/notify";
import { useThemeColors } from "@/theme/colors";
import { CANCEL_REASONS } from "./cancel-reasons";

// ЖИЗНЬ ЗАПИСИ — ВНИЗУ ЕЁ СТРАНИЦЫ (аудит STORY-072, волна 3). Старый лист
// умел отменить визит с причиной и удалить запись; страница `/book` этого не
// унаследовала, и действия жили только в долгом нажатии по календарю
// (STORY-064: «иначе возможность просто исчезнет из продукта»). Карточка
// стоит последней, как «Удалить контакт» в Контактах: разрушительное — в
// конце, отдельно от полей. Мастеру её нет: сервер пускает ему только
// движение вперёд (scheduled → in_progress → completed).

export function AppointmentLifecycleCard({
  appointment,
  onStatusChanged,
  onDeleted,
}: {
  appointment: Appointment;
  /** Страница держит статус своим состоянием: без синхронизации «Сохранить»
   *  вернул бы записи прежний статус поверх отмены. */
  onStatusChanged: (status: Appointment["status"]) => void;
  onDeleted: () => void;
}) {
  const t = useThemeColors();
  const toast = useToast();
  const role = useCurrentRole().data;
  const updateMut = useUpdateAppointment();
  const deleteMut = useDeleteAppointment();
  if (role !== "owner" && role !== "dispatcher") return null;

  const event = isCalendarEvent(appointment);
  const cancelled = appointment.status === "cancelled";
  const busy = updateMut.isPending || deleteMut.isPending;

  const setStatus = (
    status: Appointment["status"],
    cancel_reason: string | null,
    done: string,
    undo: { status: Appointment["status"]; cancel_reason: string | null },
  ) => {
    updateMut.mutate(
      { id: appointment.id, patch: { status, cancel_reason } },
      {
        onSuccess: () => {
          haptics.success();
          onStatusChanged(status);
          if (status === "cancelled") void cancelAppointmentReminders(appointment.id);
          toast(done, "info", {
            label: "Вернуть",
            onPress: () =>
              updateMut.mutate(
                { id: appointment.id, patch: undo },
                {
                  onSuccess: () => onStatusChanged(undo.status),
                  onError: () => toast("Не удалось вернуть статус", "error"),
                },
              ),
          });
        },
        onError: (error) =>
          toast(error instanceof Error ? error.message : "Не удалось изменить запись", "error"),
      },
    );
  };

  /** Отмена — с причиной из короткого списка; «Без причины» тоже честный ответ. */
  const cancelVisit = async () => {
    const options = [...CANCEL_REASONS, "Без причины"];
    const index = await chooseOption(event ? "Отменить событие?" : "Почему отменяем?", options.map((label) => ({ label })));
    if (index == null) return;
    const reason = index < CANCEL_REASONS.length ? options[index] : null;
    setStatus("cancelled", reason, event ? "Событие отменено" : "Визит отменён", {
      status: appointment.status,
      cancel_reason: appointment.cancel_reason,
    });
  };

  const restore = () =>
    setStatus("scheduled", null, "Возвращена в план", {
      status: "cancelled",
      cancel_reason: appointment.cancel_reason,
    });

  const remove = () => {
    // Запись с деньгами — история расчётов; её отменяют или возвращают деньги,
    // но не стирают (то же правило, что в меню календаря).
    const hasMoney =
      !event &&
      ((appointment.payment_status ?? "unpaid") !== "unpaid" ||
        appointment.prepaid_amount > 0 ||
        (appointment.paid_amount ?? 0) > 0 ||
        appointment.payments.length > 0);
    if (hasMoney) {
      notify(
        "Запись хранится в истории",
        "Запись с оплатой нельзя удалить. Отмените её или оформите возврат, чтобы история расчётов сохранилась.",
      );
      return;
    }
    void confirmAction(event ? "Удалить событие?" : "Удалить запись?", {
      message: "Действие необратимо; файлы записи тоже исчезнут.",
      confirmLabel: "Удалить",
      destructive: true,
    }).then((ok) => {
      if (!ok) return;
      deleteMut.mutate(appointment.id, {
        onSuccess: () => {
          void cancelAppointmentReminders(appointment.id);
          haptics.warning();
          toast(event ? "Событие удалено" : "Запись удалена", "info");
          onDeleted();
        },
        onError: (error) =>
          toast(error instanceof Error ? error.message : "Не удалось удалить", "error"),
      });
    });
  };

  return (
    <SectionCard>
      {cancelled ? (
        <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
          <Text style={{ fontSize: 13, color: t.sub }}>
            {`Отменена${appointment.cancel_reason ? ` · ${appointment.cancel_reason}` : ""}`}
          </Text>
        </View>
      ) : null}
      {cancelled ? (
        <ActionRow label="Вернуть в план" dimmed={busy} onPress={restore} />
      ) : (
        <ActionRow label={event ? "Отменить событие" : "Отменить визит"} tone="danger" dimmed={busy} onPress={() => void cancelVisit()} />
      )}
      <ActionRow label={event ? "Удалить событие" : "Удалить запись"} tone="danger" separated dimmed={busy} onPress={remove} />
    </SectionCard>
  );
}
