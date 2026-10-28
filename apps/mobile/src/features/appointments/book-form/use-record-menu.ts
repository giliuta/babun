import { useState, type MutableRefObject } from "react";
import { useNavigation, type Href, type useRouter } from "expo-router";
import type { Appointment, AppointmentStatus } from "@babun/shared/local/appointments";
import type { useToast } from "@/components/ui/Toast";
import type { ActionMenu, ActionMenuItem } from "@/components/blocks/ActionMenuSheet";
import { haptics } from "@/lib/haptics";
import { humanDayTitle } from "@/features/appointments/helpers";
import { useCalendarActions } from "@/features/appointments/useRecordRights";
import { canMutateCalendarAppointment, isCalendarEvent } from "@/features/calendar/event-access";
import { useRecordLifecycle } from "@/features/calendar/home/use-record-lifecycle";
import { withBaselineStatus } from "@/features/appointments/edit-baseline";
import { useCurrentRole } from "@/session/tenant";
import { useSession } from "@/providers/SessionProvider";

interface RecordMenuInput {
  isEdit: boolean;
  editing: Appointment | null;
  hydrated: boolean;
  archivedRecord: boolean;
  workInPlan: boolean;
  nudgeTariff: () => void;
  /** Шапка меню — кто, как в меню календаря. */
  menuTitle: string;
  setStatus: (status: AppointmentStatus) => void;
  editBaselineRef: MutableRefObject<string | null>;
  leaveBook: () => void;
  /** Уход в копию через вопрос о несохранённом (`useLeaveGuard`). */
  leaveThen: (run: (saved: Partial<Appointment> | null) => void) => void;
  toast: ReturnType<typeof useToast>;
  router: ReturnType<typeof useRouter>;
}

/** «⋯» в шапке открытой записи — то же меню, что долгое нажатие по ней в
 *  календаре, без пунктов сетки: дату, время и цвет правят на самой странице. */
export function useRecordMenu({
  isEdit,
  editing,
  hydrated,
  archivedRecord,
  workInPlan,
  nudgeTariff,
  menuTitle,
  setStatus,
  editBaselineRef,
  leaveBook,
  leaveThen,
  toast,
  router,
}: RecordMenuInput) {
  const [recordMenu, setRecordMenu] = useState<ActionMenu | null>(null);
  const role = useCurrentRole().data;
  const userId = useSession().session?.user.id ?? null;
  const can = useCalendarActions(editing?.team_id ?? null);
  const navigation = useNavigation();
  const lifecycle = useRecordLifecycle({
    toast,
    // Статус сменился мимо «Сохранить» — форма и её снимок «как в базе»
    // узнают его, иначе «Сохранить» вернул бы старый, а «назад» спросил бы
    // про изменения, которых человек не делал.
    onStatus: (_apt, status) => {
      setStatus(status);
      editBaselineRef.current = withBaselineStatus(editBaselineRef.current, status);
    },
    // Удалённой записи на экране делать нечего — назад, откуда пришли.
    onTrashed: () => leaveBook(),
  });

  // «КОПИРОВАТЬ» — КАК В КАЛЕНДАРЕ: СНАЧАЛА «КУДА», ПОТОМ КОПИЯ. Копия
  // создавалась сразу в тот же слот, дублем поверх оригинала, и место
  // приходилось править руками (У6). Теперь запись уходит в календарь, в
  // режим зелёных кубиков (`useRecordCopyLink`); событие на весь день
  // кубиками не ставится — оно открывается формой нового (как `copyInPlace`).
  // С НЕСОХРАНЁННЫМИ ПРАВКАМИ — СНАЧАЛА ВОПРОС (CAL-22): уход — после ответа,
  // копия — с сохранённого.
  const copy = (source: Appointment) => leaveThen(() => copyFrom(source));
  const copyFrom = (apt: Appointment) => {
    if (apt.event_all_day === true) {
      router.replace({
        pathname: "/book",
        params: { copyOf: apt.id, kind: "event", date: apt.date, ...(apt.team_id ? { teamId: apt.team_id } : {}) },
      } as Href);
      return;
    }
    // Вкладки под страницей — возвращаемся к ним, а не рожаем вторую копию
    // всех вкладок (`replace` в корневом стеке); холодная ссылка — `replace`.
    const href = { pathname: "/", params: { copyRecord: apt.id } } as Href;
    const tabsBelow = navigation.getState()?.routes.some((route) => route.name === "(dashboard)");
    if (tabsBelow) router.dismissTo(href);
    else router.replace(href);
  };

  const items = (apt: Appointment): ActionMenuItem[] => {
    const event = isCalendarEvent(apt);
    const crew = role === "master";
    const list: ActionMenuItem[] = [];
    // Права — те же, что у меню в календаре (`createActionMenu`).
    const ownEvent = event && can.events === "write" && !!userId && apt.created_by === userId;
    const mutable = crew ? (event ? ownEvent : can.cancel) : canMutateCalendarAppointment(role, userId, apt);
    if (crew ? !event && can.move : true) list.push({ label: "Копировать", run: () => copy(apt) });
    if (!event && (!crew || can.cancel))
      list.push(
        apt.status === "cancelled"
          ? { label: "Восстановить", run: () => lifecycle.restoreCancelled(apt) }
          : { label: "Отменить запись", run: () => lifecycle.cancelVisit(apt) },
      );
    // Запись с деньгами не удаляется (правило сервера) — пункта нет вовсе.
    if (mutable && lifecycle.canDelete(apt))
      list.push({
        label: event
          ? apt.event_repeat && apt.event_repeat.kind !== "none"
            ? "Удалить серию"
            : "Удалить событие"
          : "Удалить запись",
        destructive: true,
        run: () => lifecycle.deleteAppointmentConfirmed(apt),
      });
    // Без тарифа запись клиента только смотрят: пункты остаются, тап —
    // плашка «Нужно изменить тариф», как у «Сохранить».
    return !event && !workInPlan ? list.map((item) => ({ ...item, run: nudgeTariff })) : list;
  };

  // Меню — у сохранённой записи, когда она уже на экране; у записи
  // удалённого календаря действий нет (она только для чтения).
  const menuItems = isEdit && hydrated && editing && !archivedRecord ? items(editing) : [];
  const openRecordMenu = () => {
    if (!editing || menuItems.length === 0) return;
    haptics.tap();
    setRecordMenu({
      title: menuTitle,
      subtitle: `${humanDayTitle(editing.date)}, ${editing.time_start}–${editing.time_end}`,
      items: menuItems,
    });
  };

  return {
    recordMenu,
    hasRecordMenu: menuItems.length > 0,
    openRecordMenu,
    closeRecordMenu: () => setRecordMenu(null),
  };
}
