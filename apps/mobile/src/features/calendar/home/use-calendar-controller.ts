import { createActionMenu } from "./action-menu";
import { createReschedule } from "./reschedule";
import { useRescheduleSms } from "./reschedule-sms";
import { createSlotPlacement } from "./slot-placement";
import { useCalendarClock } from "./use-calendar-clock";
import { useCalendarDeepLinks } from "./use-calendar-deep-links";
import { useCalendarGrid } from "./use-calendar-grid";
import { useCalendarHeaderNav } from "./use-calendar-header-nav";
import { useCalendarLoadState } from "./use-calendar-load-state";
import { useCalendarRights } from "./use-calendar-rights";
import { useCalendarRoute } from "./use-calendar-route";
import { useCalendarScope } from "./use-calendar-scope";
import { useCalendarSources } from "./use-calendar-sources";
import { useCalendarUiState } from "./use-calendar-ui-state";
import { useCalendarView } from "./use-calendar-view";
import { useFirstCalendar } from "./use-first-calendar";
import { useGridModes } from "./use-grid-modes";
import { useGridProps } from "./use-grid-props";
import { useQuickEvents } from "./use-quick-events";
import { useRecordActions } from "./use-record-actions";
import { useRecordColors } from "./use-record-colors";
import { useRecordCopyLink } from "./use-record-copy-link";
import { useRecordNaming } from "./use-record-naming";
import { useReminderReconcile } from "./use-reminder-reconcile";
import { useSlotNotice } from "./use-slot-notice";
import { useVisibleAppointments } from "./use-visible-appointments";

/** Everything the calendar tab renders, composed from the hooks of this
 *  folder.
 *
 *  The call order below is load-bearing: effects run in the order their
 *  hooks are called, and several of them write the same state in one commit
 *  (the business-today re-anchor runs before the deep-link params, so a
 *  linked date wins). Keep new hooks in the position their effects need. */
export function useCalendarController() {
  const sources = useCalendarSources();
  const rights = useCalendarRights(sources);
  const ui = useCalendarUiState();
  const route = useCalendarRoute();
  const modes = useGridModes(route);
  const view = useCalendarView(route);
  const base = { ...sources, ...rights, ...ui, ...route, ...modes, ...view };

  const scope = useCalendarScope(base);
  const scoped = { ...base, ...scope };

  const { clientNameRef } = useReminderReconcile(scoped);
  const clock = useCalendarClock(scoped);
  const timed = { ...scoped, ...clock, clientNameRef };
  useCalendarDeepLinks(timed);

  const naming = useRecordNaming(timed);
  const named = { ...timed, ...naming };
  const colors = useRecordColors(named);
  const coloured = { ...named, ...colors };
  const notice = useSlotNotice(coloured);
  const visible = useVisibleAppointments(coloured);
  const listed = { ...coloured, ...notice, ...visible };

  const firstCalendar = useFirstCalendar(listed);
  const actions = useRecordActions(listed);
  const acting = { ...listed, ...actions, ...firstCalendar };
  useRecordCopyLink(acting);
  const quick = useQuickEvents(acting);
  const headerNav = useCalendarHeaderNav(acting);
  const grid = useCalendarGrid(acting);
  const gridded = { ...acting, ...quick, ...headerNav, ...grid };

  const smsOnMove = useRescheduleSms(gridded.clients);
  const reschedule = createReschedule({ ...gridded, smsOnMove });
  const createAt = createSlotPlacement(gridded);
  const openActionMenu = createActionMenu(gridded);
  const wired = { ...gridded, reschedule, createAt, openActionMenu };

  const handlers = useGridProps(wired);
  const load = useCalendarLoadState(wired);
  return { ...wired, ...handlers, ...load };
}

export type CalendarController = ReturnType<typeof useCalendarController>;
