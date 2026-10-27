import { useEffect } from "react";
import type { Href } from "expo-router";
import { parseYMD } from "@/features/appointments/helpers";
import { returnToParam } from "@/features/appointments/return-to";
import { startOfDay } from "./dates";
import type { CalendarRoute } from "./use-calendar-route";
import type { CalendarSources } from "./use-calendar-sources";
import type { CalendarUiState } from "./use-calendar-ui-state";
import type { CalendarView } from "./use-calendar-view";

type UseCalendarDeepLinksDeps =
  Pick<CalendarRoute, "router" | "params">
  & Pick<CalendarSources, "teamsPending" | "teamsError" | "teamsLoading" | "appointmentsQuery"
    | "error" | "isLoading" | "appts" | "teams" | "toast">
  & Pick<CalendarView, "setDay" | "setMode" | "setTeamChoice">
  & Pick<CalendarUiState, "setFinModalYmd" | "setSlotDraft" | "setSheetMenu" | "setSmsOpen"
    | "setReminderFor" | "setRecolor" | "setCityPickerYmd" | "setMiniCalOpen">;

/** Route params that steer the calendar from outside: open a record,
 *  start a new one, or show a date. */
export function useCalendarDeepLinks(deps: UseCalendarDeepLinksDeps) {
  const {
    router, params, teamsPending, teamsError, teamsLoading, appointmentsQuery, error,
    isLoading, appts, setDay, setMode, teams, setTeamChoice,
    setFinModalYmd, setSlotDraft, setSheetMenu, setSmsOpen, setReminderFor, setRecolor,
    setCityPickerYmd, setMiniCalOpen, toast,
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
        // ОДНА СТРАНИЦА ЗАПИСИ ДЛЯ ВСЕХ — и владельцу, и сотруднику, и на
        // чужом событии: двери на ней гаснут по правам сами. Дорогу назад
        // отдаём ей же параметром — словарь дорог `resolveReturnTo` один на
        // весь продукт.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- сеттеры экрана и router стабильны; эффект ждёт только параметров и данных
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
