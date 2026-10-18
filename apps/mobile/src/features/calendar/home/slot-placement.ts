import type { Href } from "expo-router";
import type { Appointment } from "@babun/shared/local/appointments";
import { duplicateAppointment } from "@babun/shared/local/appointments";
import { randomUuid } from "@babun/shared/sync";
import { haptics } from "@/lib/haptics";
import { addMinutesHM, humanDay } from "@/features/appointments/helpers";
import { captionFor, offStateAt } from "@/features/calendar/BookSlotSheet";
import { dayMonthLabel } from "@/features/calendar/day-month-label";
import {
  cancelAppointmentReminders,
  syncEventAppointmentReminders,
} from "@/features/calendar/reminders";
import { isCalendarEvent } from "@/features/calendar/event-access";
import { serverReason } from "@/features/calendar/server-reason";
import { SERVICES_HOLD_TEAM, SETTLED_STAYS, isPersonalEvent, settledVisit } from "./appointment-rules";
import { servicesBlockTeamMove } from "@/features/appointments/booking-selection";
import { isPastSlotAt } from "./dates";
import type { CalendarClock } from "./use-calendar-clock";
import type { CalendarGrid } from "./use-calendar-grid";
import type { CalendarRights } from "./use-calendar-rights";
import type { CalendarRoute } from "./use-calendar-route";
import type { CalendarScope } from "./use-calendar-scope";
import type { CalendarSources } from "./use-calendar-sources";
import type { CalendarUiState } from "./use-calendar-ui-state";
import type { GridModes } from "./use-grid-modes";
import type { QuickEvents } from "./use-quick-events";
import type { RecordActions } from "./use-record-actions";
import type { RecordNaming } from "./use-record-naming";
import type { SlotNotice } from "./use-slot-notice";

type CreateSlotPlacementDeps =
  Pick<CalendarClock, "todayYmd" | "nowMinutes">
  & Pick<CalendarGrid, "freeSlotsFor" | "moveWindowMin" | "workBandFor">
  & Pick<CalendarSources, "toast" | "teams" | "updateAppt" | "servicesQuery">
  & Pick<GridModes, "pickClientId" | "pick" | "setMoving" | "editingApt" | "setEditingApt"
    | "moving" | "placedFromRef" | "movingKind">
  & Pick<CalendarScope, "activeTeamId">
  & Pick<CalendarRoute, "pushBookOnce" | "router" | "tenantId">
  & Pick<CalendarRights, "isCrew">
  & Pick<RecordActions, "memberCopy" | "createAppt">
  & Pick<QuickEvents, "attemptId" | "settleAttempt">
  & Pick<RecordNaming, "appointmentTimeZone">
  & Pick<SlotNotice, "setNotice">
  & Pick<CalendarUiState, "setSlotDraft">;

/** A tap on empty grid time: finish a free move, place a move or a copy on
 *  a green slot, pick a time for a client, or open the new-record sheet. */
export function createSlotPlacement(deps: CreateSlotPlacementDeps) {
  const {
    todayYmd, nowMinutes, freeSlotsFor, toast, pickClientId, pick, activeTeamId,
    pushBookOnce, setMoving, isCrew, memberCopy, moveWindowMin, attemptId,
    settleAttempt, createAppt, router, teams, updateAppt, appointmentTimeZone,
    editingApt, setEditingApt, moving, placedFromRef, movingKind, workBandFor,
    setNotice, setSlotDraft, tenantId, servicesQuery,
  } = deps;
  // Копия или перенос в другую команду с услугами прайса своей команды.
  const servicesHoldTeam = (apt: Appointment, toTeam: string | null) =>
    toTeam !== apt.team_id &&
    !isCalendarEvent(apt) &&
    servicesBlockTeamMove(apt.service_ids ?? [], servicesQuery.data ?? [], toTeam);
  /** В ПРОШЛОЕ ЗАПИСЫВАЮТ ТОЛЬКО ЧЕРЕЗ ПЛАШКУ: в прошлом сверху
   *  выезжает плашка с кнопкой. Глухой запрет мешал бы ровно там, где выезд
   *  состоялся, а завести его забыли. Поэтому у правила есть дверь, и человек
   *  открывает её осознанно, одним тапом по кнопке на плашке (см. createAt).
   *  Перенос существующей записи это не трогает: у него свои правила. */
  const isPastSlot = (dateYmd: string, timeStart: string): boolean =>
    isPastSlotAt(dateYmd, timeStart, todayYmd, nowMinutes);

  /** В режимах подбора и переноса запись ставится ТОЛЬКО в кубик. Зелень обещает «здесь
   *  у команды свободно»; тап мимо неё (обед, нерабочий час, щель между
   *  визитами) уходил в форму молча — и обещание оказывалось краской. */
  const rejectOutsideFreeSlots = (
    dateYmd: string,
    timeStart: string,
  ): boolean => {
    if (!freeSlotsFor) return false;
    const [h, m] = timeStart.split(":").map(Number);
    const startMin = (h || 0) * 60 + (m || 0);
    if ((freeSlotsFor?.(dateYmd) ?? []).some((s) => s.startMin === startMin)) {
      return false;
    }
    haptics.warning();
    toast("Выберите зелёное время — там команда свободна", "info");
    return true;
  };

  /** Выбрали время в режиме подбора — уходим в форму записи с ним. */
  const pickSlotForClient = (dateYmd: string, timeStart: string) => {
    if (!pickClientId) return;
    pushBookOnce({
      pathname: "/book",
      params: {
        clientId: pickClientId,
        ...(pick?.locationId ? { locationId: pick.locationId } : {}),
        ...(activeTeamId ? { teamId: activeTeamId } : {}),
        // Услуги прошлого визита («Повторить») доезжают до формы вместе с
        // выбранным временем.
        date: dateYmd,
        // Форма ждёт именно `time_start` — под именем `time` выбранный кубик
        // молча терялся и запись открывалась на дефолтные 10:00.
        time_start: timeStart,
      },
    });
  };

  /** Тап по кубику в режиме копии: копия встаёт в выбранное время выбранной
   *  команды, оригинал остаётся на месте. «Открыть» в тосте — сразу на
   *  правку копии, «Отменить» — копия удаляется. */
  const copyToSlot = (apt: Appointment, dateYmd: string, timeStart: string): boolean => {
    if (rejectOutsideFreeSlots(dateYmd, timeStart)) return false;
    setMoving(null);
    // СОТРУДНИК КОПИРУЕТ НА СЕРВЕРЕ И ТОЛЬКО В ТУ ЖЕ КОМАНДУ:
    // копия встаёт туда же, где оригинал, какой бы чип ни был выбран.
    if (isCrew) {
      const attempt = `copy|${apt.id}|${dateYmd}|${timeStart}`;
      memberCopy.mutate(
        {
          sourceId: apt.id,
          date: dateYmd,
          timeStart,
          timeEnd: addMinutesHM(timeStart, moveWindowMin),
          id: attemptId(attempt),
        },
        {
          onSuccess: () => {
            settleAttempt(attempt);
            haptics.success();
            toast(`Скопировано: ${humanDay(dateYmd)}, ${timeStart}`, "success");
          },
          onError: (e) => toast(serverReason(e) ?? "Не удалось скопировать", "error"),
        },
      );
      return true;
    }
    const copyTeam = isPersonalEvent(apt) ? apt.team_id : (activeTeamId ?? apt.team_id);
    if (servicesHoldTeam(apt, copyTeam)) {
      toast(SERVICES_HOLD_TEAM, "info");
      return false;
    }
    const copy = {
      ...duplicateAppointment(apt),
      id: randomUuid(),
      date: dateYmd,
      time_start: timeStart,
      time_end: addMinutesHM(timeStart, moveWindowMin),
      team_id: isPersonalEvent(apt) ? apt.team_id : (activeTeamId ?? apt.team_id),
    };
    createAppt.mutate(copy, {
      onSuccess: () => {
        haptics.success();
        toast(`Скопировано: ${humanDay(dateYmd)}, ${timeStart}`, "success", {
          label: "Открыть",
          onPress: () => router.push(`/book?appointmentId=${copy.id}` as Href),
        });
      },
      onError: (e) => toast(serverReason(e) ?? "Не удалось скопировать", "error"),
    });
    return true;
  };

  /** Тап по кубику в режиме переноса: запись уезжает туда целиком, длительность
   *  прежняя; напоминания события переезжают следом, напоминание о визите
   *  снимается (оно целилось в старое время). Откат — из тоста. */
  const moveToSlot = (apt: Appointment, dateYmd: string, timeStart: string): boolean => {
    if (rejectOutsideFreeSlots(dateYmd, timeStart)) return false;
    // Сотрудник переносит только внутри команды записи.
    const toTeam = isCrew || isPersonalEvent(apt) ? apt.team_id : (activeTeamId ?? apt.team_id);
    const teamChanges = toTeam !== apt.team_id;
    // Оплаченная — только в её дне; режим остаётся: кубик её дня ещё можно
    // выбрать.
    if ((teamChanges || dateYmd !== apt.date) && settledVisit(apt)) {
      toast(SETTLED_STAYS, "info");
      return false;
    }
    if (servicesHoldTeam(apt, toTeam)) {
      toast(SERVICES_HOLD_TEAM, "info");
      return false;
    }
    setMoving(null);
    if (!teamChanges && apt.date === dateYmd && apt.time_start === timeStart) return true;
    const prev = {
      date: apt.date,
      time_start: apt.time_start,
      time_end: apt.time_end,
      ...(teamChanges ? { team_id: apt.team_id } : {}),
    };
    const next = {
      date: dateYmd,
      time_start: timeStart,
      time_end: addMinutesHM(timeStart, moveWindowMin),
      // В ДРУГУЮ КОМАНДУ — ТЕМ ЖЕ ТАПОМ: чип над сеткой выбран, кубики — её.
      ...(teamChanges ? { team_id: toTeam } : {}),
    };
    const tz = appointmentTimeZone(apt);
    const syncReminders = (placed: Appointment) => {
      if (!isCalendarEvent(placed)) void cancelAppointmentReminders(placed.id);
      else if (tenantId) void syncEventAppointmentReminders(placed, tz, tenantId);
    };
    updateAppt.mutate(
      { id: apt.id, patch: next },
      {
        onSuccess: () => {
          haptics.success();
          syncReminders({ ...apt, ...next });
          const teamName = teamChanges
            ? teams.find((tm) => tm.id === toTeam)?.name
            : null;
          toast(
            `Перенесено: ${teamName ? `${teamName}, ` : ""}${humanDay(dateYmd)}, ${timeStart}`,
            "success",
            {
            label: "Отменить",
            onPress: () =>
              updateAppt.mutate(
                { id: apt.id, patch: prev },
                {
                  onSuccess: () => syncReminders(apt),
                  onError: (e) =>
                    toast(serverReason(e) ?? "Не удалось вернуть запись", "error"),
                },
              ),
            },
          );
        },
        onError: (e) => toast(serverReason(e) ?? "Не удалось перенести", "error"),
      },
    );
    return true;
  };

  /** Тап по пустому времени — одна дорога для Недели и Дня. */
  const createAt = (dateYmd: string, timeStart: string) => {
    // СВОБОДНОЕ ПЕРЕМЕЩЕНИЕ: ТАП ПО ПУСТОМУ МЕСТУ — ГОТОВО: запись двигают пальцем —
    // по времени, по дням, в соседнюю неделю краем экрана; тап только
    // отпускает её (если бы тап переносил запись в место тапа, «отпустить» её
    // было бы нечем, кроме крестика на плашке).
    if (editingApt) {
      // Тик даёт сама колонка (`onSlotPress`) — второй здесь был бы дублем.
      setEditingApt(null);
      return;
    }
    // Режим переноса: тап по кубику — переезд записи, не новая запись.
    if (moving) {
      // ОДИН ТАП — ОДНА КОПИЯ. Второй тап по кубику
      // до перерисовки видел тот же `moving` и ставил вторую копию: настоящую
      // запись, а клиенту при включённом шаблоне — второе SMS о записи.
      if (placedFromRef.current === moving) return;
      const placed =
        movingKind === "copy"
          ? copyToSlot(moving, dateYmd, timeStart)
          : moveToSlot(moving, dateYmd, timeStart);
      if (placed) placedFromRef.current = moving;
      return;
    }
    // Кнопка на плашке зовёт ровно тот же путь, минуя проверки: на них уже
    // ответили тапом по кнопке.
    const open = () => {
      haptics.tap();
      if (pickClientId) {
        pickSlotForClient(dateYmd, timeStart);
        return;
      }
      setSlotDraft({ date: dateYmd, time: timeStart });
    };
    if (rejectOutsideFreeSlots(dateYmd, timeStart)) return;
    // ПЛАШКА ВЫЕЗЖАЕТ НА ТАП ПО СЕТКЕ, И РОВНО ОДИН РАЗ: тап на кнопку плашки открывает
    // выбор времени, не триггеря её несколько раз. Поэтому причина считается ЗДЕСЬ, до листа, и она одна:
    // прошлое сильнее нерабочего часа — в позавчерашний выходной незачем
    // говорить дважды. Дальше по дороге не спрашивает никто: ни лист выбора
    // времени, ни сама форма записи.
    const [hh, mm] = timeStart.split(":").map(Number);
    const off = offStateAt(workBandFor?.(dateYmd), (hh || 0) * 60 + (mm || 0));
    const reason = isPastSlot(dateYmd, timeStart)
      ? "Это время уже прошло"
      : off
        ? captionFor(off)
        : null;
    if (reason) {
      haptics.warning();
      const [ny, nm, nd] = dateYmd.split("-").map(Number);
      setNotice({
        id: Date.now(),
        // Дата — всегда, и сегодня тоже.
        when: `${dayMonthLabel(new Date(ny, nm - 1, nd))}, ${timeStart}`,
        message: reason,
        onAction: () => {
          setNotice(null);
          open();
        },
      });
      return;
    }
    setNotice(null);
    open();
  };

  return createAt;
}

export type CreateAt = ReturnType<typeof createSlotPlacement>;
