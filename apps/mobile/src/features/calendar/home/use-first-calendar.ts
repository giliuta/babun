import { tourEvent } from "@/components/tour/tour-store";
import type { Team } from "@/features/reference/queries";
import type { CalendarSources } from "./use-calendar-sources";
import type { CalendarView } from "./use-calendar-view";

type UseFirstCalendarDeps =
  Pick<CalendarSources, "refetchTeams">
  & Pick<CalendarView, "setTeamChoice" | "rememberView">;

/** What happens after the owner names and creates the account's first
 *  calendar. */
export function useFirstCalendar(deps: UseFirstCalendarDeps) {
  const { refetchTeams, setTeamChoice, rememberView } = deps;

  // ПЕРВЫЙ КАЛЕНДАРЬ ЗАВОДИТ ЧЕЛОВЕК, И САМ ДАЁТ ЕМУ ИМЯ. Сам по себе
  // календарь не создаётся: «Личный», заведённый молча, был чужим словом в
  // ленте, и переименовывать его приходилось первым же делом.
  //
  // Сразу после создания — СЕТКА ЭТОГО КАЛЕНДАРЯ, и обучение идёт дальше:
  // что где на экране, потом шестерёнка и настройки.
  const onFirstCalendarCreated = (team: Team) => {
    setTeamChoice(team.id);
    rememberView({ teamId: team.id });
    tourEvent("calendar-created");
  };

  // Календарь успело завести другое устройство того же аккаунта: создавать
  // нечего, список перечитывается и экран сам уходит в сетку. Обучение идёт
  // дальше так же, как после своего создания: календарь есть.
  const onFirstCalendarExisting = () => {
    void refetchTeams();
    tourEvent("calendar-created");
  };

  return { onFirstCalendarCreated, onFirstCalendarExisting };
}
