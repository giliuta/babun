import { useEffect } from "react";
import type { CalendarRoute } from "./use-calendar-route";
import type { CalendarSources } from "./use-calendar-sources";
import type { CalendarView } from "./use-calendar-view";
import type { RecordActions } from "./use-record-actions";

type Deps =
  Pick<CalendarRoute, "router" | "params">
  & Pick<CalendarSources, "teamsPending" | "teamsError" | "appointmentsQuery" | "appts" | "teams" | "toast">
  & Pick<CalendarView, "setTeamChoice">
  & Pick<RecordActions, "startMove">;

/** «Копировать» со страницы записи (`?copyRecord=`) — тот же режим зелёных
 *  кубиков, что у «Копировать» из меню календаря: копия встаёт туда, куда
 *  тапнули, а не дублем поверх оригинала. Параметр только доставляет
 *  задание — приняли и стёрли, дальше режимом владеет экран. */
export function useRecordCopyLink({
  router, params, teamsPending, teamsError, appointmentsQuery, appts, teams, toast,
  setTeamChoice, startMove,
}: Deps) {
  const copyId = params.copyRecord;
  useEffect(() => {
    if (!copyId || teamsPending || teamsError || appointmentsQuery.isPending) return;
    router.setParams({ copyRecord: "" });
    // Из кеша, а не из адреса: правка, сохранённая вопросом перед копией,
    // уже лежит в нём (`useUpdateAppointment` пишет кеш сразу).
    const source = appts.find((a) => a.id === copyId);
    if (!source) {
      toast("Заявка не найдена или больше недоступна");
      return;
    }
    // Запись другой команды — сетка той команды, иначе кубики считались бы
    // по чужому расписанию.
    if (source.team_id && teams.some((t) => t.id === source.team_id)) setTeamChoice(source.team_id);
    startMove(source, "copy");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- задание принимается один раз, когда данные готовы
  }, [copyId, teamsPending, teamsError, appointmentsQuery.isPending, appts, teams]);
}
