import { confirmAction } from "@/lib/confirm";
import { notify } from "@/lib/notify";
import { haptics } from "@/lib/haptics";
import type { useToast } from "@/components/ui/Toast";
import type {
  Appointment,
  AppointmentStatus,
} from "@babun/shared/local/appointments";
import { getPaidAmount } from "@babun/shared/local/appointments";
import { money } from "@babun/shared/common/utils/money";
import { serverReason } from "@/features/calendar/server-reason";
import { cancelAppointmentReminders } from "@/features/calendar/reminders";
import { isCalendarEvent } from "@/features/calendar/event-access";
import {
  useQuietUpdateAppointment,
  useTrashAppointment,
} from "@/features/calendar/mutations";
import { useRestoreAppointment } from "@/features/calendar/deleted-appointments";
import { holdsMoney, keptForMoneyHistory } from "./appointment-rules";
import { useInvoices } from "@/features/finances/invoices-queries";

interface RecordLifecycleInput {
  toast: ReturnType<typeof useToast>;
  /** Статус записи сменился на сервере — отменой, возвратом или откатом из
   *  тоста. Странице записи это нужно, чтобы «Сохранить» не вернул старый. */
  onStatus?: (apt: Appointment, status: AppointmentStatus) => void;
  /** Запись ушла в «Удалённые записи». */
  onTrashed?: (apt: Appointment) => void;
}

/** Отмена записи, возврат в план и удаление — одна дорога для меню записи в
 *  календаре и для «⋯» на её странице: вопросы, деньги и тосты одинаковые. */
export function useRecordLifecycle({ toast, onStatus, onTrashed }: RecordLifecycleInput) {
  const updateAppt = useQuietUpdateAppointment();
  const trashAppt = useTrashAppointment();
  const restoreAppt = useRestoreAppointment();
  // Инвойс по записи — любой, и погашенный кредит-нотой тоже: сервер не
  // удаляет запись, у которой он есть.
  const invoices = useInvoices().data;
  const invoicedIds = new Set((invoices ?? []).map((i) => i.appointment_id).filter(Boolean));
  /** Можно ли удалить запись — правилом сервера (`keptForMoneyHistory`). */
  const canDelete = (apt: Appointment) => !keptForMoneyHistory(apt, invoicedIds.has(apt.id));

  /** Отмена и возврат в план — одна дорога с откатом из тоста. Причины
   *  отмены нет: запись отменяется одним тапом, а прежняя причина у старой
   *  записи стирается при «Восстановить». */
  const setCancelled = (apt: Appointment, cancel: boolean) => {
    const to: Appointment["status"] = cancel ? "cancelled" : "scheduled";
    const prev = { status: apt.status, cancel_reason: apt.cancel_reason ?? null };
    // У отмены с деньгами в тосте нет «Отменить»: сервер уже вернул оплату
    // клиенту, и откат вернул бы запись неоплаченной — это решение человек
    // принимает осознанно через «Восстановить» с вопросом, а не тапом по тосту.
    const undoable = to !== "cancelled" || !holdsMoney(apt);
    updateAppt.mutate(
      { id: apt.id, patch: { status: to, cancel_reason: null } },
      {
        onSuccess: () => {
          haptics.success();
          if (to === "cancelled") void cancelAppointmentReminders(apt.id);
          onStatus?.(apt, to);
          toast(
            to === "cancelled" ? "Визит отменён" : "Запись восстановлена",
            "info",
            undoable
              ? {
                  label: "Отменить",
                  onPress: () =>
                    updateAppt.mutate(
                      { id: apt.id, patch: prev },
                      {
                        onSuccess: () => onStatus?.(apt, prev.status),
                        // Без колбэка откат падал молча: options-level onError
                        // хука гасит глобальный алерт MutationCache.
                        onError: (e) =>
                          toast(serverReason(e) ?? "Не удалось вернуть запись", "error"),
                      },
                    ),
                }
              : undefined,
          );
        },
        onError: (e) =>
          toast(serverReason(e) ?? "Не удалось изменить запись", "error"),
      },
    );
  };

  /** «Восстановить» отменённую. Если при отмене оплата вернулась клиенту,
   *  запись вернётся неоплаченной — человек узнаёт это до, а не после. */
  const restoreCancelled = (apt: Appointment) => {
    if (apt.payment_status !== "refunded") {
      setCancelled(apt, false);
      return;
    }
    void confirmAction("Вернуть запись?", {
      message:
        "При отмене оплата вернулась клиенту. Запись вернётся неоплаченной — новую оплату примете как обычно.",
      confirmLabel: "Вернуть запись",
    }).then((ok) => {
      if (ok) setCancelled(apt, false);
    });
  };

  /** «Отменить запись» — сразу, без причины. Отмена записи с деньгами — это
   *  возврат: сервер сам возвращает клиенту всю полученную оплату, поэтому о
   *  ней — вопрос с суммой, а вернуть запись потом можно уже без оплаты. */
  const cancelVisit = (apt: Appointment) => {
    if (!holdsMoney(apt)) {
      setCancelled(apt, true);
      return;
    }
    const paid = getPaidAmount(apt);
    void confirmAction("Отменить запись с оплатой?", {
      message: `${paid > 0 ? `Клиенту вернётся ${money(paid)}` : "Полученная оплата вернётся клиенту"}: в кассе появится возврат. Запись можно будет вернуть — уже без оплаты.`,
      confirmLabel: "Отменить запись",
      destructive: true,
    }).then((ok) => {
      if (ok) setCancelled(apt, true);
    });
  };

  const deleteAppointmentConfirmed = (apt: Appointment) => {
    const repeating = apt.event_repeat && apt.event_repeat.kind !== "none";
    const hasRecordedPayment =
      isCalendarEvent(apt) === false &&
      (((apt.payment_status ?? "unpaid") !== "unpaid") ||
        apt.prepaid_amount > 0 ||
        (apt.paid_amount ?? 0) > 0 ||
        apt.payments.length > 0 ||
        apt.payment != null);
    if (hasRecordedPayment || !canDelete(apt)) {
      // Отменённая с возвратом — уже «отменена и возвращена»: совет «отмените
      // или оформите возврат» был тупиком.
      notify(
        "Запись хранится в истории",
        apt.status === "cancelled" || apt.payment_status === "refunded"
          ? "У записи был возврат оплаты — она остаётся в истории расчётов, удалить её нельзя."
          : "Запись с оплатой нельзя удалить. Отмените её или оформите возврат, чтобы история расчётов сохранилась.",
      );
      return;
    }
    // «УДАЛЁННЫЕ ЗАПИСИ»: удалённое 30 дней лежит в ящике шестерёнки
    // календаря и возвращается оттуда или «Отменить» в тосте — вместе с фото.
    // Серия — одна строка (повторы рисует правило), в ящик уходит целиком.
    // Личное событие без календаря в ящик не идёт (у ящика, как у всего в
    // компании, есть команда) — для него прежний вопрос «необратимо».
    const toTrash = apt.team_id != null;
    const event = isCalendarEvent(apt);
    void confirmAction(
      repeating ? "Удалить всю серию?" : event ? "Удалить событие?" : "Удалить запись?",
      {
        message: !toTrash
          ? "Действие необратимо."
          : repeating
            ? "Серия со всеми повторами будет в «Удалённых записях» 30 дней."
            : event
              ? "Событие будет в «Удалённых записях» 30 дней."
              : "Запись будет в «Удалённых записях» 30 дней.",
        confirmLabel: repeating ? "Удалить серию" : "Удалить",
        destructive: true,
      },
    ).then((ok) => {
      if (!ok) return;
      trashAppt.mutate(apt.id, {
        onSuccess: () => {
          void cancelAppointmentReminders(apt.id);
          haptics.warning();
          onTrashed?.(apt);
          const said = event ? "Событие удалено" : "Запись удалена";
          toast(
            said,
            "info",
            toTrash
              ? {
                  label: "Отменить",
                  onPress: () =>
                    restoreAppt.mutate(apt.id, {
                      onError: (e) => toast(serverReason(e) ?? "Не удалось вернуть", "error"),
                    }),
                }
              : undefined,
          );
        },
        onError: (e) => toast(serverReason(e) ?? "Не удалось удалить", "error"),
      });
    });
  };

  return { setCancelled, restoreCancelled, cancelVisit, deleteAppointmentConfirmed, canDelete };
}
