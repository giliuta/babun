import { useEffect, useRef } from "react";
import { PRESET_COLOR_CYCLE } from "@babun/shared/common/utils/colors";
import type { CalendarRoute } from "./use-calendar-route";
import type { CalendarSources } from "./use-calendar-sources";
import type { CalendarUiState } from "./use-calendar-ui-state";
import type { CalendarView } from "./use-calendar-view";

type UseFirstCalendarDeps =
  Pick<CalendarSources, "teams" | "createFirstCalendarMutation" | "refetchTeams" | "toast"
    | "role" | "teamsPending" | "teamsFetching" | "teamsError" | "teamsAll">
  & Pick<CalendarView, "setTeamChoice" | "rememberView">
  & Pick<CalendarUiState, "setFirstCalendarFailed">
  & Pick<CalendarRoute, "tenantId">;

/** The tenant's first calendar is created automatically for the owner. */
export function useFirstCalendar(deps: UseFirstCalendarDeps) {
  const {
    teams, createFirstCalendarMutation, refetchTeams, setTeamChoice, rememberView,
    setFirstCalendarFailed, toast, tenantId, role, teamsPending, teamsFetching,
    teamsError, teamsAll,
  } = deps;
  // Заводит первый календарь тенанта. Вызывается АВТОМАТИЧЕСКИ эффектом
  // ниже; кнопка осталась только запасным выходом, если автосоздание не
  // прошло (нет связи, отказ базы).
  const createFirstCalendar = () => {
    const used = new Set(
      (teams as { color?: string | null }[]).map((tm) => tm.color).filter(Boolean),
    );
    const color =
      PRESET_COLOR_CYCLE.find((c) => !used.has(c.value))?.value ??
      PRESET_COLOR_CYCLE[0].value;
    createFirstCalendarMutation.mutate(
      // «Личный», а не «Команда 1»: у человека, который только что завёл
      // первый календарь, ещё нет никаких «команд» — счётчик в имени это язык
      // базы, а не язык владельца. У каждого аккаунта есть
      // свой «Личный» — события и свои деньги без тарифа; переименовывается
      // под шестерёнкой.
      { name: "Личный", color },
      {
        onSuccess: (team) => {
          // Календарь у компании уже есть — пустым список прочли по ошибке
          // (без входа, на гонке двух устройств). Ничего не заводим, только
          // перечитываем список: база ответила, что создавать нечего.
          if (!team) {
            void refetchTeams();
            return;
          }
          setTeamChoice(team.id);
          rememberView({ teamId: team.id });
          // Тоста нет намеренно: календарь заводится САМ, человек его не
          // просил — сообщать ему о результате действия, которого он не
          // совершал, значит требовать внимания ни за чем. Имя видно в
          // чипе над сеткой, переименование живёт под шестерёнкой.
          //
          // СЧЕТОВ САМИ НЕ ЗАВОДИМ. Первый счёт
          // человек заводит сам, со своим названием: «Финансы» без счёта
          // встречают именно этой кнопкой.
        },
        onError: () => {
          // Автосоздание не прошло — показываем кнопку как ручной выход.
          // Молча оставить пустой экран нельзя: человек окажется в
          // календаре, которого нет, без единого способа это исправить.
          setFirstCalendarFailed(true);
          toast("Не удалось создать календарь");
        },
      },
    );
  };

  // КАЛЕНДАРЬ ЗАВОДИТСЯ САМ: при первом заходе календарь уже создан.
  //
  // Шаг с кнопкой был бы пустым: единственная кнопка единственного экрана
  // делала ровно одно действие без единого выбора — ни имени, ни цвета, ни
  // типа. Экран, который спрашивает «продолжить?», не спрашивает ничего.
  //
  // Условия строгие, потому что цена ошибки — лишняя команда в базе:
  // только владелец (мастер календарей не заводит), только когда список
  // команд ДОЗАГРУЖЕН и пуст, только один раз за жизнь экрана (ref, а не
  // state — он не должен перезапускать эффект).
  //
  // «ДОЗАГРУЖЕН» — ЭТО ОТВЕТ, А НЕ «НЕ ГРУЗИТСЯ». Без сети
  // запрос команд стоит на паузе: данных нет, `isFetching` и `isError`
  // ложны — и пустой список читался как «календарей нет». Владелец получал
  // второй «Личный», как только возвращалась сеть. Поэтому ждём `isPending`.
  // Раз — на КОМПАНИЮ, а не на жизнь экрана: экран переход переживает.
  const firstCalendarStarted = useRef<string | null>(null);
  useEffect(() => {
    if (!tenantId || firstCalendarStarted.current === tenantId) return;
    if (role !== "owner") return;
    if (teamsPending || teamsFetching || teamsError) return;
    // Скрытые свои — тоже календари: второй «Личный» им не нужен.
    if (teamsAll.length > 0) return;
    firstCalendarStarted.current = tenantId;
    createFirstCalendar();
    // createFirstCalendar намеренно не в зависимостях: он пересоздаётся
    // каждый рендер, и его включение превратило бы эффект в цикл.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, role, teamsPending, teamsFetching, teamsError, teamsAll.length]);

  return {
    createFirstCalendar,
  };
}

export type FirstCalendar = ReturnType<typeof useFirstCalendar>;
