import { useMemo, useRef } from "react";
import type { Href } from "expo-router";
import type { Appointment } from "@babun/shared/local/appointments";
import { createBlankAppointment } from "@babun/shared/local/appointments";
import { randomUuid } from "@babun/shared/sync";
import { haptics } from "@/lib/haptics";
import { addMinutesHM, humanDayTitle } from "@/features/appointments/helpers";
import { useEventBlocks } from "@/features/appointments/booking-prefs";
import { usePersonalEventTypes } from "@/features/settings/local-settings";
import { eventTypeIcon } from "@/features/reference/event-type-icons";
import { serverReason } from "@/features/calendar/server-reason";
import type { CalendarRights } from "./use-calendar-rights";
import type { CalendarRoute } from "./use-calendar-route";
import type { CalendarScope } from "./use-calendar-scope";
import type { CalendarSources } from "./use-calendar-sources";
import type { CalendarUiState } from "./use-calendar-ui-state";
import type { RecordActions } from "./use-record-actions";
import type { VisibleAppointments } from "./use-visible-appointments";

type UseQuickEventsDeps =
  Pick<CalendarRights, "canManageBookings" | "isCrew">
  & Pick<CalendarScope, "activeActions" | "activeTeamId">
  & Pick<VisibleAppointments, "eventsOn">
  & Pick<CalendarUiState, "setSheetMenu">
  & Pick<CalendarRoute, "router">
  & Pick<RecordActions, "createAppt" | "deleteAppt">
  & Pick<CalendarSources, "toast">;

/** Long press on free time — the quick-event sheet — plus copies made in
 *  place, and the attempt ids that keep retries from duplicating. */
export function useQuickEvents(deps: UseQuickEventsDeps) {
  const {
    canManageBookings, isCrew, activeActions, eventsOn, activeTeamId, setSheetMenu,
    router, createAppt, deleteAppt, toast,
  } = deps;
  // ═══ ДОЛГОЕ НАЖАТИЕ ПО СВОБОДНОМУ ВРЕМЕНИ — «БЫСТРОЕ СОБЫТИЕ» ═══
  // Не сразу перерыв, а шторка снизу — перечень типов событий, чтобы не
  // заводить событие с нуля. Шторка — та же `ActionMenuSheet`: типы из
  // справочника (значок, цвет, длительность — как при выборе типа в форме
  // события), и ничего кроме них. Только ускорение: «Другое событие» нет —
  // для этого обычный путь; значок справа в шапке ведёт в «Типы событий» —
  // завести свой тип быстро. Тап по свободному времени по-прежнему заводит
  // запись, метка дня — тапом по числу. Право — заводить события в этом
  // календаре.
  const canAddBreak =
    canManageBookings || (isCrew && activeActions.events === "write");
  // Функция «События» выключена — событий нет в сетке ни у кого (`byTeam`),
  // и быстрое событие рождалось невидимым: тост «Обед · Отменить», а на сетке
  // пусто.
  const canSlotMenu = canAddBreak && eventsOn;
  // Типы событий открытой команды (у каждой команды свои).
  const eventTypesQuery = usePersonalEventTypes(activeTeamId);
  // Блок «Тип» у события выключен — типов в быстром событии нет.
  const eventTypesOn = useEventBlocks(activeTeamId).includes("type");
  const quickTypes = useMemo(
    () =>
      (eventTypesQuery.data ?? [])
        .filter((type) => !type.hidden)
        .sort((a, b) => a.order - b.order),
    [eventTypesQuery.data],
  );
  const slotMenu = (dateYmd: string, timeStart: string) => {
    haptics.tap();
    // ТОЛЬКО ТИПЫ ИЗ СПРАВОЧНИКА: перерыв — это тип события; нет типов —
    // шторка открывается пустой. Встроенного «Перерыва» нет: нужен — заводится типом.
    setSheetMenu({
      title: "Быстрое событие",
      subtitle: `${humanDayTitle(dateYmd)}, ${timeStart}`,
      items: (eventTypesOn ? quickTypes : []).map((type) => ({
        label: type.label,
        icon: eventTypeIcon(type.icon),
        color: type.color,
        run: () =>
          addQuickEvent(dateYmd, timeStart, {
            label: type.label,
            color: type.color,
            // Длительность типа — как в форме события (`applyEventType`);
            // «весь день» форма больше не ставит, и здесь его нет.
            minutes: type.defaultDuration,
          }),
      })),
      // Справочник типов правят владелец и диспетчер; у сотрудника двери нет.
      onSettings: canManageBookings && eventTypesOn
        ? () =>
            router.push({
              pathname: "/calendar/event-types",
              params: activeTeamId ? { team: activeTeamId } : {},
            } as Href)
        : undefined,
      settingsLabel: "Типы событий",
      // Пустая шторка говорит, почему пусто, и куда идти — значок справа.
      emptyText: !eventTypesOn
        ? "Тип события выключен в «Записях»"
        : canManageBookings
          ? "Типов пока нет — заведите их значком справа"
          : "Типов пока нет",
    });
  };
  // ПОВТОР ТОГО ЖЕ ДЕЙСТВИЯ — ТОТ ЖЕ НОМЕР ЗАПИСИ. На слабой связи запись вставала, а ответ обрывался: тост «Не
  // удалось…», человек повторял — и номер был новый, то есть вторая запись
  // (и второе SMS клиенту о записи). Номер попытки живёт, пока она не
  // удалась: повтор того же действия несёт его же, и сервер отвечает уже
  // вставшей записью.
  const attemptIdsRef = useRef(new Map<string, string>());
  const attemptId = (key: string) => {
    const known = attemptIdsRef.current.get(key);
    if (known) return known;
    const id = randomUuid();
    attemptIdsRef.current.set(key, id);
    return id;
  };
  const settleAttempt = (key: string) => attemptIdsRef.current.delete(key);
  const addQuickEvent = (
    dateYmd: string,
    timeStart: string,
    preset: { label: string; color: string; minutes: number },
  ) => {
    const attempt = `event|${activeTeamId ?? ""}|${dateYmd}|${timeStart}|${preset.label}`;
    // ID — СРАЗУ UUID: на Hermes нет `crypto.randomUUID`, и
    // пустая запись рождалась с `apt-…`; создание меняло его на uuid, а
    // «Отменить» в тосте удаляло прежний `apt-…` — событие оставалось.
    const ev = { ...createBlankAppointment({
      kind: "event",
      date: dateYmd,
      time_start: timeStart,
      time_end: addMinutesHM(timeStart, preset.minutes),
      team_id: activeTeamId ?? null,
      master_id: null,
      status: "scheduled",
      // Название события — имя типа, как у события из формы: по нему форма
      // сама узнаёт тип при открытии.
      comment: preset.label,
      color_override: preset.color,
      event_all_day: false,
      service_ids: [],
      services: [],
      total_amount: 0,
    }), id: attemptId(attempt) };
    createAppt.mutate(ev, {
      onSuccess: () => {
        settleAttempt(attempt);
        haptics.success();
        toast(`${preset.label} ${timeStart}–${ev.time_end}`, "success", {
          label: "Отменить",
          onPress: () =>
            deleteAppt.mutate(ev.id, {
              onError: (e) =>
                toast(serverReason(e) ?? "Не удалось убрать событие", "error"),
            }),
        });
      },
      onError: (e) =>
        toast(serverReason(e) ?? "Не удалось добавить событие", "error"),
    });
  };

  // КОПИЯ СОБЫТИЯ НА ВЕСЬ ДЕНЬ — ФОРМОЙ НОВОГО, А НЕ ГОТОВОЙ ЗАПИСЬЮ. Копия
  // создавалась до формы, и кто вышел из неё, не меняя дня, оставлял дубль
  // без «Отменить» (CAL-33). Теперь событие появится только на «Создать».
  const copyInPlace = (apt: Appointment) => {
    const source = (apt as { virtualParentId?: string }).virtualParentId ?? apt.id;
    router.push({
      pathname: "/book",
      params: { copyOf: source, kind: "event", date: apt.date, ...(apt.team_id ? { teamId: apt.team_id } : {}) },
    } as Href);
  };

  return {
    canSlotMenu, slotMenu, attemptId, settleAttempt, copyInPlace,
  };
}

export type QuickEvents = ReturnType<typeof useQuickEvents>;
