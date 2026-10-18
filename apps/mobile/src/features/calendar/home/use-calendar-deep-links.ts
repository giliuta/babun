import { useEffect } from "react";
import type { Href } from "expo-router";
import { parseYMD } from "@/features/appointments/helpers";
import {
  resolveReturnTo,
  returnToParam,
} from "@/features/appointments/return-to";
import { startOfDay } from "./dates";
import type { CalendarRights } from "./use-calendar-rights";
import type { CalendarRoute } from "./use-calendar-route";
import type { CalendarSources } from "./use-calendar-sources";
import type { CalendarUiState } from "./use-calendar-ui-state";
import type { CalendarView } from "./use-calendar-view";

type UseCalendarDeepLinksDeps =
  Pick<CalendarRoute, "router" | "params" | "returnToRef">
  & Pick<CalendarSources, "teamsPending" | "teamsError" | "teamsLoading" | "appointmentsQuery"
    | "error" | "isLoading" | "appts" | "teams" | "toast">
  & Pick<CalendarView, "setDay" | "setMode" | "setTeamChoice">
  & Pick<CalendarUiState, "setFinModalYmd" | "setSlotDraft" | "setSheetMenu" | "setSmsOpen"
    | "setReminderFor" | "setRecolor" | "setCityPickerYmd" | "setMiniCalOpen"
    | "setCrewViewing">
  & Pick<CalendarRights, "isCrew" | "canMutateAppointment">;

/** Route params that steer the calendar from outside: open a record,
 *  start a new one, or show a date. */
export function useCalendarDeepLinks(deps: UseCalendarDeepLinksDeps) {
  const {
    router, params, teamsPending, teamsError, teamsLoading, appointmentsQuery, error,
    isLoading, appts, setDay, setMode, teams, setTeamChoice, returnToRef,
    setFinModalYmd, setSlotDraft, setSheetMenu, setSmsOpen, setReminderFor, setRecolor,
    setCityPickerYmd, setMiniCalOpen, isCrew, canMutateAppointment, setCrewViewing,
    toast,
  } = deps;
  useEffect(() => {
    const clearParams = () =>
      router.setParams({
        new: undefined,
        clientId: undefined,
        locationId: undefined,
        teamId: undefined,
        date: undefined,
        kind: undefined,
        appointmentId: undefined,
      });
    // Гонка с загрузкой команд: на холодном старте по диплинку teams=[]
    // ещё «не знает» ответа — гасить параметры рано (визит с карточки
    // молча пропадал). Ждём резолва: эффект перезапустится по
    // teamsLoading/teams и обработает параметры уже с данными.
    // `isPending`, а не `isLoading`: без сети запрос стоит на паузе с
    // `isLoading` = false, список пуст — и запись из уведомления объявлялась
    // «не найденной», а параметры стирались.
    if (
      teamsPending ||
      teamsError ||
      (params.appointmentId && (appointmentsQuery.isPending || error))
    ) {
      return;
    }
    if (params.appointmentId) {
      const target = appts.find(
        (appointment) => appointment.id === params.appointmentId,
      );
      if (target) {
        const requestedDate =
          params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date)
            ? params.date
            : target.date;
        setDay(startOfDay(parseYMD(requestedDate)));
        setMode("day");
        if (
          target.team_id &&
          teams.some((team) => team.id === target.team_id)
        ) {
          setTeamChoice(target.team_id);
        }
        // Запомнили дорогу назад ДО гашения параметров: сами параметры живут
        // один кадр, а вернуться нужно, когда лист закроют. Словарь дорог —
        // `resolveReturnTo`, один на весь продукт.
        returnToRef.current = resolveReturnTo(params.from);
        // ЛИСТЫ КАЛЕНДАРЯ УХОДЯТ ПЕРЕД ЗАПИСЬЮ. Тап по
        // уведомлению, пока открыт, скажем, «Финансы дня», открывал страницу
        // записи ПОД листом: человек видел прежний лист и думал, что тап не
        // сработал. Цель пришла снаружи — всё, что было открыто, закрываем.
        setFinModalYmd(null);
        setSlotDraft(null);
        setSheetMenu(null);
        setSmsOpen(false);
        setReminderFor(null);
        setRecolor(null);
        setCityPickerYmd(null);
        setMiniCalOpen(false);
        // Владельцу и диспетчеру — СТРАНИЦА записи (STORY-064: форма одна);
        // старый лист правки здесь больше не открывается. Дорогу назад отдаём
        // ей же: `returnToRef` читает только лист бригадира, а страница —
        // отдельное окно и про наш ref не знает.
        // Сотрудник открывает ТУ ЖЕ страницу записи (STORY-088): блоки на ней гаснут по его правам сами.
        if (!isCrew && !canMutateAppointment(target)) setCrewViewing(target);
        else
          router.push(
            `/book?appointmentId=${target.id}${returnToParam(params.from)}` as Href,
          );
      } else {
        toast("Заявка не найдена или больше недоступна");
      }
      clearParams();
    } else if (params.new === "1") {
      // Без единой команды шит бессмысленен (стейл-дефолты), а экран занят
      // first-run гейтом «Создать календарь» — параметры просто гасим.
      if (teams.length === 0) {
        clearParams();
        return;
      }
      // ?date= вместе с new=1 (возвраты: «Записать» на дату ТО) — префилл
      // даты черновика; валидируем формат, мусор не пускаем (web parity).
      const draftDate =
        params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date)
          ? params.date
          : undefined;
      // Букинг в чужую команду («Записать» с карточки): активируем её
      // календарь, чтобы созданная запись не «пропала» из виду при возврате.
      if (params.teamId && teams.some((tm) => tm.id === params.teamId)) {
        setTeamChoice(params.teamId);
      }
      const draftKind =
        params.kind === "event" ? "event" : params.kind === "work" ? "work" : undefined;
      // Карточка клиента → «Записать» теперь ведёт на отдельный экран /book
      // (тот же маршрут, что тап по слоту), а не открывает шит-модал.
      router.push({
        pathname: "/book",
        params: {
          ...(params.clientId ? { clientId: params.clientId } : {}),
          ...(params.locationId ? { locationId: params.locationId } : {}),
          ...(params.teamId ? { teamId: params.teamId } : {}),
          ...(draftDate ? { date: draftDate } : {}),
          ...(draftKind ? { kind: draftKind } : {}),
        },
      });
      clearParams();
    } else if (params.date) {
      // Переход по дате (карточка клиента, визиты мастера) = «покажи этот
      // день»: открываем именно День (web ?view=day&date= parity).
      const d = parseYMD(params.date);
      setDay(startOfDay(d));
      setMode("day");
      // ?teamId= — команда записи: без переключения визит чужой команды
      // открывал бы пустой день активной команды.
      if (params.teamId && teams.some((tm) => tm.id === params.teamId)) {
        setTeamChoice(params.teamId);
      }
      router.setParams({ date: undefined, teamId: undefined });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    params.appointmentId,
    params.new,
    params.clientId,
    params.date,
    params.teamId,
    teamsLoading,
    teamsError,
    teams,
    isLoading,
    error,
    appts,
  ]);
}
