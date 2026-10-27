import type { Appointment } from "@babun/shared/local/appointments";
import {
  findBufferClash,
  findOverlap,
} from "@babun/shared/common/utils/appointment-overlap";
import { haptics } from "@/lib/haptics";
import { humanDay, parseYMD } from "@/features/appointments/helpers";
import {
  cancelAppointmentReminders,
  syncEventAppointmentReminders,
} from "@/features/calendar/reminders";
import { isCalendarEvent } from "@/features/calendar/event-access";
import { serverReason } from "@/features/calendar/server-reason";
import { SERVICES_HOLD_TEAM, SETTLED_STAYS, settledVisit } from "./appointment-rules";
import { servicesBlockTeamMove } from "@/features/appointments/booking-selection";
import { startOfDay } from "./dates";
import { settleGate } from "./settle-gate";
import { scheduleWarning } from "./work-band";
import type { CalendarGrid } from "./use-calendar-grid";
import type { CalendarRights } from "./use-calendar-rights";
import type { CalendarSources } from "./use-calendar-sources";
import type { CalendarView } from "./use-calendar-view";
import type { GridModes } from "./use-grid-modes";
import type { RecordNaming } from "./use-record-naming";
import type { VisibleAppointments } from "./use-visible-appointments";

type CreateRescheduleDeps =
  Pick<CalendarRights, "isCrew" | "workInPlan" | "nudgeTariff" | "canMoveAppointment">
  & Pick<CalendarSources, "toast" | "updateAppt" | "teams" | "visibilityTenantId" | "servicesQuery">
  & Pick<VisibleAppointments, "visibleAppts" | "weekYmds">
  & Pick<CalendarGrid, "workBandFor" | "bufferMinutes">
  & Pick<CalendarView, "mode" | "setDay">
  & Pick<GridModes, "editingApt" | "setEditingApt">
  & Pick<RecordNaming, "appointmentTimeZone">
  & {
    /** Уйдёт ли клиенту SMS «При переносе» (`reschedule-sms.ts`). */
    smsOnMove: (apt: Appointment, teamId: string | null, date: string, timeStart: string) => boolean;
  };

/** Drag and stretch on the grid: move a record in time, across days or to
 *  another own team, warn softly and offer an undo. */
export function createReschedule(deps: CreateRescheduleDeps) {
  const {
    isCrew, toast, workInPlan, nudgeTariff, canMoveAppointment, visibleAppts,
    workBandFor, bufferMinutes, mode, weekYmds, setDay, editingApt, setEditingApt,
    updateAppt, appointmentTimeZone, teams, visibilityTenantId, servicesQuery, smsOnMove,
  } = deps;
  const reschedule = (
    apt: Appointment,
    newStart: string,
    newEnd: string,
    newDate?: string,
    newTeam?: string | null,
  ) => {
    // Свободное перемещение двигает запись и по дням, и в другую
    // свою команду; обычная растяжка/перенос в дне даты и команды не несут.
    const date = newDate ?? apt.date;
    const teamId = newTeam === undefined ? apt.team_id : newTeam;
    const dateMoves = date !== apt.date;
    const teamMoves = teamId !== apt.team_id;
    // ЗАПИСЬ СОТРУДНИКА НЕ УХОДИТ ИЗ СВОЕЙ КОМАНДЫ: он
    // двигает её по времени и дням, но не в другую команду; сервер такой
    // перевод отбивает (`access:team_move`).
    if (isCrew && teamMoves) {
      toast("Запись остаётся в своей команде", "info");
      return;
    }
    if (!workInPlan && !isCalendarEvent(apt)) {
      nudgeTariff();
      return;
    }
    if (!canMoveAppointment(apt)) {
      toast(
        isCalendarEvent(apt)
          ? "Изменить событие может только его автор"
          : "Недостаточно прав для переноса",
        "info",
      );
      return;
    }
    // Ничего не поменялось — ни начало, ни конец. Сравнивать одно начало
    // нельзя: растяжка за нижний край меняет только конец.
    if (
      apt.time_start === newStart &&
      apt.time_end === newEnd &&
      !dateMoves &&
      !teamMoves
    )
      return;
    // Оплаченную — только в её дне: сервер отказал бы, а экран уже уехал бы
    // на новую неделю, и запись пропала бы с глаз.
    if ((dateMoves || teamMoves) && settledVisit(apt)) {
      toast(SETTLED_STAYS, "info");
      return;
    }
    if (
      teamMoves &&
      !isCalendarEvent(apt) &&
      servicesBlockTeamMove(apt.service_ids ?? [], servicesQuery.data ?? [], teamId)
    ) {
      toast(SERVICES_HOLD_TEAM, "info");
      return;
    }
    // Виртуальное вхождение повтора двигать нельзя — правится только seed
    // (id виртуала синтетический, мутация по нему невалидна).
    if ((apt as { virtualParentId?: string }).virtualParentId) {
      toast("Повтор события — измените исходную запись");
      return;
    }
    // Дабл-букинг команды — предупреждаем, но НЕ блокируем (web parity:
    // findOverlap перед записью; диспетчер иногда ставит внахлёст сознательно).
    const moved = {
      ...apt,
      date,
      team_id: teamId,
      time_start: newStart,
      time_end: newEnd,
    };
    const clash = findOverlap(moved, visibleAppts);
    // Перерыв / нерабочие часы команды — то же «предупредить, не блокировать»:
    // диспетчер иногда сознательно ставит до открытия или в обед.
    const toMin = (s: string) => {
      const [h, m] = s.split(":").map(Number);
      return h * 60 + m;
    };
    const startMin = toMin(newStart);
    const endMin = toMin(newEnd);
    const bandWarn = scheduleWarning(workBandFor?.(date), startMin, endMin);
    // Буфер на дорогу/уборку — самый слабый из трёх сигналов, поэтому
    // последним: пересечение и нерабочие часы важнее.
    const tight = findBufferClash(moved, visibleAppts, bufferMinutes);
    const warn = clash
      ? `Пересечение с ${clash.time_start}–${clash.time_end}`
      : (bandWarn ??
        (tight
          ? `Меньше ${bufferMinutes} мин до ${tight.time_start}–${tight.time_end}`
          : null));
    const patch = {
      time_start: newStart,
      time_end: newEnd,
      ...(dateMoves ? { date } : {}),
      ...(teamMoves ? { team_id: teamId } : {}),
    };
    // Запись ушла за видимую неделю («вправо сильно — перелистнёт») —
    // календарь едет за ней, чтобы она осталась перед глазами. ТОЛЬКО ЗА
    // неделю: внутри недели смена выбранного дня
    // перекручивала сетку к часу открытия того дня — запись уходила с экрана
    // посреди правки.
    if (dateMoves && !(mode === "week" && weekYmds.includes(date))) {
      setDay(startOfDay(parseYMD(date)));
    }
    if (editingApt?.id === apt.id) setEditingApt(moved);
    const gate = settleGate();
    updateAppt.mutate(
      { id: apt.id, patch },
      {
        onSuccess: () => {
          // Физический «удар» на успешное приземление drag-переноса —
          // блок лёг на слот, рука это чувствует.
          haptics.impact();
          gate.settle(true);
          if (isCalendarEvent(apt)) {
            if (visibilityTenantId) {
              void syncEventAppointmentReminders(moved, appointmentTimeZone(apt), visibilityTenantId);
            }
          } else {
            void cancelAppointmentReminders(apt.id);
          }
        },
        onError: (e) => {
          gate.settle(false);
          toast(serverReason(e) ?? "Не удалось перенести", "error");
        },
      },
    );
    // Растяжка (начало на месте) называет новое время целиком, перенос —
    // куда встала запись. «Отменить» возвращает прежние границы: жест
    // легко сделать случайно, а искать старое время по памяти нельзя.
    const teamName = teamMoves ? teams.find((tm) => tm.id === teamId)?.name : null;
    const what =
      dateMoves || teamMoves
        ? `Перенесено: ${teamName ? `${teamName}, ` : ""}${humanDay(date)}, ${newStart}`
        : apt.time_start === newStart
          ? `Время: ${newStart}–${newEnd}`
          : `Перенесено на ${newStart}`;
    // КЛИЕНТУ УЙДЁТ SMS — СЛОВАМИ В ТОМ ЖЕ ТОСТЕ. Сервер ставит шаблон «При
    // переносе» сам, и молча это было письмом от имени человека, который
    // просто подвинул блок. «Отменить» снимает и сообщение: перенос ждёт в
    // очереди дольше, чем живёт тост.
    const sms = smsOnMove(apt, teamId, date, newStart) ? "Клиенту уйдёт SMS" : null;
    const prev = {
      time_start: apt.time_start,
      time_end: apt.time_end,
      ...(dateMoves ? { date: apt.date } : {}),
      ...(teamMoves ? { team_id: apt.team_id } : {}),
    };
    toast([what, sms, warn].filter(Boolean).join(". "), "success", {
      label: "Отменить",
      onPress: () =>
        void gate.settled.then((ok) => {
          if (!ok) return;
          if (editingApt?.id === apt.id) setEditingApt({ ...apt });
          // ВИД ВОЗВРАЩАЕТСЯ ЗА ЗАПИСЬЮ: перенос на другой день увёл календарь
          // на новый день, и после отката запись «пропадала» с экрана.
          if (dateMoves) setDay(startOfDay(parseYMD(apt.date)));
          updateAppt.mutate(
            { id: apt.id, patch: prev },
            {
              // Напоминания события переставлены прямым ходом — откат
              // возвращает их к прежнему времени, иначе пуш придёт по новому.
              onSuccess: () => {
                if (isCalendarEvent(apt) && visibilityTenantId) {
                  void syncEventAppointmentReminders(apt, appointmentTimeZone(apt), visibilityTenantId);
                }
              },
              onError: (e) =>
                toast(serverReason(e) ?? "Не удалось вернуть время", "error"),
            },
          );
        }),
    });
  };

  return reschedule;
}

export type Reschedule = ReturnType<typeof createReschedule>;
