import { Screen } from "@/components/ui/Screen";
import { CrewAppointmentSheet } from "@/features/appointments/CrewAppointmentSheet";
import { MiniCalendar } from "@/features/calendar/MiniCalendar";
import { CalendarBody } from "@/features/calendar/home/CalendarBody";
import { CalendarChrome } from "@/features/calendar/home/CalendarChrome";
import { CalendarDayLabelSheet } from "@/features/calendar/home/CalendarDayLabelSheet";
import { CalendarFirstRunGate } from "@/features/calendar/home/CalendarFirstRunGate";
import { CalendarSheets } from "@/features/calendar/home/CalendarSheets";
import { useCalendarController } from "@/features/calendar/home/use-calendar-controller";

// The calendar tab. State, effects and actions live in
// `features/calendar/home/` (`useCalendarController` composes them in
// order); this file only lays the screen out.
export default function CalendarTab() {
  const c = useCalendarController();
  const {
    teams, miniCalOpen, day, mode, todayYmd, visibleAppts, jumpToDate, setMiniCalOpen,
    calendarLoading, calendarError, crewViewing, setCrewViewing, returnHome,
  } = c;

  // First-run gate (web parity: dashboard/page.tsx). No team calendar yet →
  // show the «Создать календарь» screen instead of an empty grid. Hold on a
  // spinner while teams load / the just-created team round-trips so the CTA
  // never flashes back after a successful create.
  if (teams.length === 0) {
    // Сетевой сбой ≠ «команд нет»: настроенному тенанту нельзя показывать
    // «Создать календарь» из-за упавшего запроса (риск дубля команды).
    //
    // «ЕЩЁ НЕ ЗНАЕМ» ≠ «НЕТ», И ЭТО НЕ ПРИДИРКА. `useTeams` ВЫКЛЮЧЕН, пока
    // грузится роль, а у выключенного запроса react-query держит `isLoading`
    // равным false — данных нет, загрузки «нет», и экран уверенно объявлял
    // «Календарь ещё не назначен», не начав его спрашивать. После полной
    // перезагрузки бандла это видно глазом.
    //
    // Хуже самой надписи то, что вместе с ней ИСЧЕЗАЛА ЛЕНТА: чипов ещё нет,
    // рисовать нечего — и человек оставался с «попросите владельца» без
    // единственной двери отсюда. Читается как «меня выкинули из компании».
    //
    // Поэтому конечное пустое состояние показывается, только когда известно
    // И что здесь календарей нет, И какие есть в других компаниях.
    return (
      <Screen edges={["top"]}>
        <CalendarFirstRunGate c={c} />
      </Screen>
    );
  }

  return (
    // No bottom safe-area edge here: inside expo-router Tabs the tab bar
    // already consumes it, so a bottom inset double-counts and floats the
    // Доход/Расход footer ~34pt above the tab bar. Drop it → footer sits flush.
    <Screen edges={["top", "left", "right"]}>
      <CalendarChrome c={c} />

      <CalendarBody c={c} />

      {/* ПУСТОЙ КАЛЕНДАРЬ — ПРОСТО СЕТКА. Ни «Начните за 3 шага», ни
          строки «Пока нет записей»: запись создаётся тапом по свободному
          времени, как и всегда. */}

      {/* ПЛАШКИ «N без оплаты · закройте до конца дня» БОЛЬШЕ НЕТ: долг и так виден
          янтарём в самой строке. */}

      <CalendarSheets c={c} />

      <CalendarDayLabelSheet c={c} />

      <MiniCalendar
        visible={miniCalOpen}
        currentDate={day}
        markOpenDay={mode === "day" || mode === "week"}
        todayYmd={todayYmd}
        appointments={visibleAppts}
        onSelectDate={jumpToDate}
        onClose={() => setMiniCalOpen(false)}
      />

      {/* Листа правки здесь нет (STORY-064): владелец
          и диспетчер правят запись на странице /book; лист бригады остался. */}
      <CrewAppointmentSheet
        appointment={calendarLoading || calendarError ? null : crewViewing}
        onClose={() => {
          setCrewViewing(null);
          returnHome();
        }}
      />

    </Screen>
  );
}
