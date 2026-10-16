import type { Href } from "expo-router";
import { Platform } from "react-native";
import { confirmAction } from "@/lib/confirm";
import { notify } from "@/lib/notify";
import { haptics } from "@/lib/haptics";
import type { Appointment } from "@babun/shared/local/appointments";
import { getPaidAmount } from "@babun/shared/local/appointments";
import { money } from "@babun/shared/common/utils/money";
import { parseYMD } from "@/features/appointments/helpers";
import { serverReason } from "@/features/calendar/server-reason";
import {
  cancelAppointmentReminders,
  setSelfReminder,
} from "@/features/calendar/reminders";
import {
  selfReminderLabel,
  type SelfReminder,
} from "@/lib/reminder-time";
import { isCalendarEvent } from "@/features/calendar/event-access";
import { useRouteOpener } from "@/features/clients/use-route-opener";
import {
  useCreateAppointment,
  useDeleteAppointment,
  useMemberCopyAppointment,
  useTrashAppointment,
} from "@/features/calendar/mutations";
import { useRestoreAppointment } from "@/features/calendar/deleted-appointments";
import { holdsMoney } from "./appointment-rules";
import { startOfDay } from "./dates";
import type { CalendarRights } from "./use-calendar-rights";
import type { CalendarRoute } from "./use-calendar-route";
import type { CalendarScope } from "./use-calendar-scope";
import type { CalendarSources } from "./use-calendar-sources";
import type { CalendarUiState } from "./use-calendar-ui-state";
import type { CalendarView } from "./use-calendar-view";
import type { GridModes } from "./use-grid-modes";
import type { RecordNaming } from "./use-record-naming";
import type { SlotNotice } from "./use-slot-notice";

type UseRecordActionsDeps =
  Pick<CalendarScope, "activeActions" | "activeTeamId">
  & Pick<CalendarRights, "canManageBookings" | "isCrew" | "canMutateAppointment">
  & Pick<CalendarSources, "toast" | "roleQuery" | "appts" | "updateAppt">
  & Pick<CalendarRoute, "pushBookOnce" | "tenantId">
  & Pick<CalendarUiState, "setCrewViewing" | "reminderFor" | "setReminderFor">
  & Pick<RecordNaming, "clientName" | "appointmentTimeZone">
  & Pick<GridModes, "setMoving" | "setEditingApt" | "placedFromRef" | "setPick"
    | "setMovingKind">
  & Pick<CalendarView, "mode" | "setMode" | "rememberView" | "setDay">
  & Pick<SlotNotice, "setNotice">;

/** What a tap or a menu item does to one record: open, book, cancel,
 *  restore, delete, start a move or copy, set a reminder. */
export function useRecordActions(deps: UseRecordActionsDeps) {
  const {
    activeActions, canManageBookings, isCrew, toast, roleQuery, pushBookOnce,
    activeTeamId, appts, canMutateAppointment, setCrewViewing, updateAppt,
    clientName, setMoving, setEditingApt, mode, setMode, rememberView, setDay,
    placedFromRef, setPick, setNotice, setMovingKind, reminderFor, setReminderFor,
    appointmentTimeZone, tenantId,
  } = deps;
  const createAppt = useCreateAppointment();
  const memberCopy = useMemberCopyAppointment();
  const deleteAppt = useDeleteAppointment();
  const trashAppt = useTrashAppointment();
  const restoreAppt = useRestoreAppointment();

  // Тап по свободному слоту / действие из агенды / «Записать» с карточки открывает
  // ОТДЕЛЬНЫЙ экран /book (реальный маршрут, а не шит-модал поверх попапа):
  // дата/время/команда едут параметрами, «назад» возвращает на календарь.
  // Тап уже И ЕСТЬ выбор времени — второй попап-«тумблер» больше не нужен.
  // Команда черновика — календарь, который сейчас открыт (activeTeamId).
  const bookAt = (defaults?: {
    date?: string;
    time_start?: string;
    kind?: "work" | "event";
    clientId?: string;
    locationId?: string;
  }) => {
    // Сотрудник создаёт по «Новым записям» / «Событиям: Меняет» в открытом
    // календаре (STORY-088); проверку держит и сервер.
    const kindAllowed =
      defaults?.kind === "event"
        ? activeActions.events === "write"
        : activeActions.create;
    if (!canManageBookings && !(isCrew && kindAllowed)) {
      toast(
        roleQuery.isPending
          ? "Проверяем права доступа"
          : isCrew
            ? "Новые записи в этом календаре вам не открыты"
            : "Новую запись создаёт владелец или диспетчер",
        "info",
      );
      return;
    }
    pushBookOnce({
      pathname: "/book",
      params: {
        ...(activeTeamId ? { teamId: activeTeamId } : {}),
        ...(defaults?.date ? { date: defaults.date } : {}),
        ...(defaults?.time_start ? { time_start: defaults.time_start } : {}),
        ...(defaults?.kind ? { kind: defaults.kind } : {}),
        ...(defaults?.clientId ? { clientId: defaults.clientId } : {}),
        ...(defaults?.locationId ? { locationId: defaults.locationId } : {}),
      },
    });
  };

  const openEdit = (apt: Appointment) => {
    // Виртуальное вхождение повтора редактируем через его seed-запись —
    // у виртуала синтетический id, мутации по нему невалидны (web parity).
    const parentId = (apt as { virtualParentId?: string }).virtualParentId;
    const target = parentId ? appts.find((a) => a.id === parentId) ?? apt : apt;
    // Сотрудник — на ту же страницу записи, что владелец (STORY-088): двери
    // на ней погашены по его правам. Лист просмотра остался чужому событию.
    if (!isCrew && !canMutateAppointment(target)) {
      setCrewViewing(target);
      return;
    }
    // ПРАВКА УХОДИТ НА /book: форма записи одна и создаёт, и правит (STORY-064).
    // Две формы — отдельная для создания и для правки — делали бы любую
    // правку наполовину: снос поля («Источник заявки») из одной оставлял бы
    // его в другой.
    pushBookOnce({
      pathname: "/book",
      params: { appointmentId: target.id },
    } as Href);
  };

  /** Отмена и возврат в план — одна дорога с откатом из тоста. Причины
   *  отмены нет: визит отменяется одним тапом, а прежняя причина у старой
   *  записи стирается при «Восстановить». */
  const setCancelled = (apt: Appointment, cancel: boolean) => {
    const to: Appointment["status"] = cancel ? "cancelled" : "scheduled";
    const prev = { status: apt.status, cancel_reason: apt.cancel_reason ?? null };
    // У отмены с деньгами в тосте нет «Отменить»: сервер уже вернул оплату
    // клиенту, и откат вернул бы визит неоплаченным — это решение человек
    // принимает осознанно через «Восстановить» с вопросом, а не тапом по тосту.
    const undoable = to !== "cancelled" || !holdsMoney(apt);
    updateAppt.mutate(
      { id: apt.id, patch: { status: to, cancel_reason: null } },
      {
        onSuccess: () => {
          haptics.success();
          if (to === "cancelled") void cancelAppointmentReminders(apt.id);
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
   *  визит вернётся неоплаченным — человек узнаёт это до, а не после. */
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

  /** «Отменить визит» — сразу, без причины. Отмена визита с деньгами — это
   *  возврат: сервер сам возвращает клиенту всю полученную оплату, поэтому о
   *  ней — вопрос с суммой, а вернуть визит потом можно уже без оплаты. */
  const cancelVisit = (apt: Appointment) => {
    if (!holdsMoney(apt)) {
      setCancelled(apt, true);
      return;
    }
    const paid = getPaidAmount(apt);
    void confirmAction("Отменить визит с оплатой?", {
      message: `${paid > 0 ? `Клиенту вернётся ${money(paid)}` : "Полученная оплата вернётся клиенту"}: в кассе появится возврат. Запись можно будет вернуть — уже без оплаты.`,
      confirmLabel: "Отменить визит",
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
    if (hasRecordedPayment) {
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

  /** «Перенести» из меню — в режим зелёных кубиков. Список и Месяц кубиков не
   *  рисуют, поэтому переезжаем в Неделю этой записи; выйти — крестиком на
   *  плашке, сменой команды или уходом с экрана. */
  // «СВОБОДНОЕ ПЕРЕМЕЩЕНИЕ» — ТОЛЬКО ПО СЕТКЕ. Из «Месяца» и «Списка» режим
  // включался без неё: плашка «Тяните запись», а тянуть нечего. Как «Перенести» (`startMove`) — в неделю записи.
  const startFreeMove = (apt: Appointment) => {
    setMoving(null);
    setEditingApt(apt);
    if (mode !== "week" && mode !== "day") {
      setMode("week");
      rememberView({ mode: "week" });
      setDay(startOfDay(parseYMD(apt.date)));
    }
  };

  const startMove = (apt: Appointment, kind: "move" | "copy" = "move") => {
    placedFromRef.current = null;
    setPick(null);
    setNotice(null);
    setMovingKind(kind);
    setEditingApt(null);
    setMoving(apt);
    if (mode !== "week" && mode !== "day") {
      setMode("week");
      rememberView({ mode: "week" });
    }
    setDay(startOfDay(parseYMD(apt.date)));
  };

  // «МАРШРУТ» ИЗ МЕНЮ ЗАПИСИ — та же шторка карт, что у листа выезда
  // (`useRouteOpener`): «Карты для маршрута» команды, а не Apple Карты в
  // браузере — на Android это была веб-страница вместо Google Карт.
  const recordRoute = useRouteOpener(activeTeamId ?? null);

  const openReminderMenu = (apt: Appointment) => setReminderFor(apt);
  const pickReminderFor = (rule: SelfReminder | null) => {
    const apt = reminderFor;
    setReminderFor(null);
    if (!apt || !tenantId) return;
    void setSelfReminder(apt, rule, appointmentTimeZone(apt), tenantId, clientName(apt) || undefined).then(
      (res) => {
        if (res === "cleared") toast("Напоминание снято", "info");
        else if (res === "scheduled" && rule) {
          const l = selfReminderLabel(rule);
          toast(`Напомню ${l.charAt(0).toLowerCase()}${l.slice(1)}`);
        } else if (res === "denied") toast("Разрешите уведомления в Настройках", "error");
        else if (res === "past") toast("Это время уже прошло", "info");
        else if (res === "deferred")
          toast(
            Platform.OS === "android"
              ? "Напоминание в очереди — установится, когда на телефоне освободится место"
              : "Напоминание в очереди — установится, когда на iPhone освободится место",
            "info",
          );
        else if (res === "capacity") toast("Очередь напоминаний переполнена", "error");
        else if (res === "unavailable") toast("Появится после обновления приложения", "info");
      },
    );
  };

  return {
    createAppt, memberCopy, deleteAppt, bookAt, openEdit, setCancelled,
    restoreCancelled, cancelVisit, deleteAppointmentConfirmed, startFreeMove, startMove,
    openReminderMenu, pickReminderFor, recordRoute,
  };
}

export type RecordActions = ReturnType<typeof useRecordActions>;
