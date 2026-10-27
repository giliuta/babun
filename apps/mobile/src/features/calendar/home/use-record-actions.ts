import type { Href } from "expo-router";
import { Platform } from "react-native";
import type { Appointment } from "@babun/shared/local/appointments";
import { parseYMD } from "@/features/appointments/helpers";
import { setSelfReminder } from "@/features/calendar/reminders";
import {
  selfReminderLabel,
  type SelfReminder,
} from "@/lib/reminder-time";
import { useRouteOpener } from "@/features/clients/use-route-opener";
import {
  useCreateAppointment,
  useDeleteAppointment,
  useMemberCopyAppointment,
} from "@/features/calendar/mutations";
import { useRecordLifecycle } from "./use-record-lifecycle";
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
  & Pick<CalendarRights, "canManageBookings" | "isCrew">
  & Pick<CalendarSources, "toast" | "roleQuery" | "appts">
  & Pick<CalendarRoute, "pushBookOnce" | "tenantId">
  & Pick<CalendarUiState, "reminderFor" | "setReminderFor">
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
    activeTeamId, appts,
    clientName, setMoving, setEditingApt, mode, setMode, rememberView, setDay,
    placedFromRef, setPick, setNotice, setMovingKind, reminderFor, setReminderFor,
    appointmentTimeZone, tenantId,
  } = deps;
  const createAppt = useCreateAppointment();
  const memberCopy = useMemberCopyAppointment();
  const deleteAppt = useDeleteAppointment();
  const { setCancelled, restoreCancelled, cancelVisit, deleteAppointmentConfirmed } =
    useRecordLifecycle({ toast });

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
    // ОДНА СТРАНИЦА ЗАПИСИ ДЛЯ ВСЕХ: сотрудник и владелец на чужом событии
    // открывают ту же /book, двери на ней гаснут по правам (`useBookRights`).
    // ПРАВКА УХОДИТ НА /book: форма записи одна и создаёт, и правит (STORY-064).
    // Две формы — отдельная для создания и для правки — делали бы любую
    // правку наполовину: снос поля («Источник заявки») из одной оставлял бы
    // его в другой.
    pushBookOnce({
      pathname: "/book",
      params: { appointmentId: target.id },
    } as Href);
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
