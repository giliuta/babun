import {
  startTransition,
  useCallback,
  useEffect,
  useOptimistic,
  useRef,
} from "react";
import { useFocusEffect } from "expo-router";
import { useCalendarChips } from "@/session/workspaces";
import { FOREIGN_PREFIX } from "@/session/calendar-chips";
import { dayMoneyGate, seesDayMoney } from "@/features/calendar/day-money-access";
import type { CalendarRights } from "./use-calendar-rights";
import type { CalendarSources } from "./use-calendar-sources";
import type { CalendarView } from "./use-calendar-view";
import type { GridModes } from "./use-grid-modes";

type UseCalendarScopeDeps =
  Pick<CalendarSources, "teams" | "toast" | "ownAllHidden" | "visibilityTenantId"
    | "roleQuery" | "teamsPending" | "calendarVisibility" | "role" | "myAccessQuery">
  & Pick<CalendarRights, "isCrew" | "actionsIn" | "dayLabelsOn" | "canManageBookings">
  & Pick<GridModes, "setMoving" | "pick">
  & Pick<CalendarView, "setTeamChoice" | "rememberView" | "teamChoice">;

/** The open calendar: the chips ribbon, the active team and what the
 *  viewer may do in it. */
export function useCalendarScope(deps: UseCalendarScopeDeps) {
  const {
    teams, toast, ownAllHidden, visibilityTenantId, roleQuery, teamsPending,
    calendarVisibility, role, myAccessQuery, isCrew, actionsIn, dayLabelsOn,
    canManageBookings, setMoving, setTeamChoice, rememberView, teamChoice, pick,
  } = deps;
  // КАЛЕНДАРИ ДРУГИХ КОМПАНИЙ СТОЯТ В ТОЙ ЖЕ ЛЕНТЕ (в ряд, а не отдельной кнопкой «другие»).
  //
  // Человек думает календарями, а не компаниями: свой, рабочий, ещё один —
  // один ряд, один выбор. Что под чужим чипом лежит переход в другую
  // компанию (пауза синхронизации, чистка кэша, новый токен) — наша работа,
  // и человеку про неё знать незачем.

  // Лента календарей: свои плюс чужие, одним рядом. Правила склейки и
  // переход в другую компанию живут в `useCalendarChips` — та же лента стоит
  // над финансами, и двух её копий быть не должно.
  const {
    items: chipItems,
    pick: pickCalendar,
    pendingId: pendingChipId,
    loading: chipsLoading,
  } = useCalendarChips({
    own: teams,
    onPickOwn: (teamId) => {
      // РЕЖИМ ПЕРЕНОСА/КОПИИ ПЕРЕЖИВАЕТ СМЕНУ СВОЕГО КАЛЕНДАРЯ: так запись
      // уезжает в другую команду — переключил чип, кубики показывают её
      // свободное время, тап ставит запись туда. Чужая компания режим
      // снимает (эффект по `tenantId` ниже): запись не может сменить
      // компанию.
      // ЧИП ЗАГОРАЕТСЯ В ТОМ ЖЕ КАДРЕ, СЕТКА ДОГОНЯЕТ ПЕРЕХОДОМ. Отрисовка
      // недели другого календаря — самая тяжёлая работа экрана, и пока она
      // шла срочно, тап выглядел несработавшим. Подсветка берёт оптимистичное
      // значение (`chipTeamId`), которое React показывает, пока переход не
      // закоммичен, и само возвращается к `activeTeamId` после.
      startTransition(() => {
        showChipTeam(teamId);
        setTeamChoice(teamId);
      });
      rememberView({ teamId });
      // У СОТРУДНИКА ЗАПИСЬ ИЗ СВОЕЙ КОМАНДЫ НЕ УХОДИТ — зелёные кубики
      // другой команды показывали бы её время, а запись вставала бы в своей
      // поверх занятого. Режим снимается.
      if (isCrew) setMoving(null);
    },
    onSwitchError: (message) => toast(message, "error"),
  });

  // ВСЕ СВОИ СКРЫТЫ — В ЧУЖОЙ КАЛЕНДАРЬ (скрытый «Личный»
  // не показывается, а смотреть человек будет календарь, которым с ним
  // поделились). Только пока экран на виду: из шестерёнки, где скрытый
  // включают обратно, никуда не уводим. Раз на аккаунт — без петли на сбое.
  const hiddenSwitchTried = useRef<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (!ownAllHidden || pendingChipId) return;
      const target = chipItems.find((chip) => chip.id.startsWith(FOREIGN_PREFIX));
      if (!target || hiddenSwitchTried.current === visibilityTenantId) return;
      hiddenSwitchTried.current = visibilityTenantId;
      pickCalendar(target.id);
      // pickCalendar пересоздаётся каждый рендер — сторожем служит ref.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ownAllHidden, pendingChipId, chipItems, visibilityTenantId]),
  );

  // ЕЩЁ НЕ ЗНАЕМ, ЕСТЬ ЛИ ЗДЕСЬ КАЛЕНДАРИ И КАКИЕ ЕСТЬ В ДРУГИХ КОМПАНИЯХ.
  //
  // `teamsPending`, а не `teamsLoading`: список команд ВЫКЛЮЧЕН, пока грузится
  // роль, а у выключенного запроса `isLoading` равен false. Ответ «нет
  // данных» тогда неотличим от «данных не спрашивали».
  //
  // Ошибка роли сюда НЕ входит намеренно: она своя и показывается своим
  // экраном, а вечный скелет вместо неё — тупик хуже прежнего.
  // СКРЫТЫЕ ТОЖЕ ДОЛЖНЫ БЫТЬ ИЗВЕСТНЫ: без списка скрытых первым
  // кадром открылся бы скрытый. Список берётся с телефона, ждать сервер
  // приходится только при самом первом входе.
  const calendarsUnknown =
    !roleQuery.isError && (teamsPending || chipsLoading || !calendarVisibility.known);

  // Active team calendar. Derived (not stored) so it self-heals: falls back
  // to the first team until the user picks one, and re-anchors if the chosen
  // team disappears. Null only while there are no teams (→ first-run gate).
  const activeTeamId =
    // УДАЛЁННЫЙ КАЛЕНДАРЬ СЮДА НЕ ПОПАДАЕТ ДАЖЕ ИЗ ПАМЯТИ ВЫБОРА: его нет в
    // `teams`, и выбор сам перескакивает на первый живой. Иначе удалённая
    // команда висела бы в ленте (`calendar-delete.ts`).
    teamChoice && teams.some((tm) => tm.id === teamChoice)
      ? teamChoice
      : teams[0]?.id ?? null;
  const activeTeam = teams.find((tm) => tm.id === activeTeamId);
  // Что сотрудник может в открытом календаре: новые записи, события, метка
  // дня. Владельцу — всё.
  const activeActions = actionsIn(activeTeamId);
  const canManageDayLabels =
    dayLabelsOn && (canManageBookings || activeActions.dayLabels === "write");
  const canCreateOnGrid =
    canManageBookings ||
    (isCrew && (activeActions.create || activeActions.events === "write"));
  // ДЕНЬГИ В КАЛЕНДАРЕ — ПРАВОМ КАЛЕНДАРЯ «ДОХОД И РАСХОД ДНЯ» (финансы этого
  // календаря за день, не общая картина; `day-money-access.ts`). Права
  // «Финансов» полосу больше не открывают. Смена уровня приходит сигналом и
  // перерисовывает полосу сразу. Доход и расход дня — одно право: обе строки
  // полосы и месяц с прибылью видны вместе.
  const seesDayMoneyHere = seesDayMoney(
    dayMoneyGate({ role, map: myAccessQuery.data, teamId: activeTeamId }),
  );
  const seesIncome = seesDayMoneyHere;
  const seesExpense = seesDayMoneyHere;
  const canViewCompanyFinance = seesDayMoneyHere;
  // Полоса денег под календарём — всегда, кому видны деньги (тумблера нет).
  const showDayFinance = canViewCompanyFinance;
  // Подсветка чипа своего календаря — см. `onPickOwn`: пока переход смены
  // календаря не закоммичен, лента показывает тапнутый чип, а не прежний.
  const [chipTeamId, showChipTeam] = useOptimistic(activeTeamId);

  // ПОДБОР ВРЕМЕНИ ПЕРЕКЛЮЧАЕТ КАЛЕНДАРЬ НА БРИГАДУ КЛИЕНТА. Иначе свободное
  // время считалось по команде, открытой в чипе: постоянного клиента команды
  // Б показывали и записывали к команде А просто потому, что вчера смотрели
  // её календарь.
  const pickTeamId = pick?.teamId ?? null;
  useEffect(() => {
    if (!pickTeamId) return;
    if (!teams.some((tm) => tm.id === pickTeamId)) return;
    setTeamChoice((prev) => (prev === pickTeamId ? prev : pickTeamId));
  }, [pickTeamId, teams, setTeamChoice]);

  return {
    chipItems, pickCalendar, pendingChipId, calendarsUnknown, activeTeamId, activeTeam,
    activeActions, canManageDayLabels, canCreateOnGrid, seesIncome, seesExpense,
    canViewCompanyFinance, showDayFinance, chipTeamId,
  };
}

export type CalendarScope = ReturnType<typeof useCalendarScope>;
