import { useRef } from "react";
import { ScrollView } from "react-native";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { SavedIndicator } from "@/features/calendar/SavedIndicator";
import { CalendarChipsBar } from "./CalendarChipsBar";
import { CalendarExitRows } from "./CalendarExitRows";
import { CalendarReferenceRows } from "./CalendarReferenceRows";
import { CalendarSettingsSheets } from "./CalendarSettingsSheets";
import { CalendarTeamRows } from "./CalendarTeamRows";
import { useCalendarSettingsScreen } from "./use-calendar-settings-screen";
import { TourScrollProvider } from "@/components/tour/TourTarget";

// ─── «Календарь» — ВСЕ настройки на одном экране ─────────────────────
// Сюда ведёт шестерёнка. Уровня «/calendar/[teamId]» больше нет: целый экран
// ради двух строк — это лишний этап, а не архитектура. Настройки открытого
// календаря встроены сюда же.
//
// Область действия задаёт ЗАГОЛОВОК СЕКЦИИ, а не этаж навигации: первая
// секция названа именем календаря, вторая — «Все календари». Раньше границу
// держала ступень навигации, но это стоило пользователю лишнего тапа на
// каждый заход, а календарь у покупателя, как правило, один.
//
// Строки «Команда» здесь тоже нет. Она вела в стек ТАБОВ из стека, лежащего
// НАД табами: push плодил второй экземпляр табов, navigate ломал «назад»
// (возвращал в календарь вместо настроек). Управление командой живёт в
// Кабинет → Команды — там ему и место, а этот экран про календарь.
export function CalendarSettingsScreen() {
  const screen = useCalendarSettingsScreen();
  const { settingsQuery, teams, teamsLoading, savedTick, team, rows, canLeave } = screen;
  // Обучение докручивает к строке, которую объясняет.
  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(0);

  if (teamsLoading || settingsQuery.isLoading) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Настройки календаря" />
        <EmptyState state="loading" fill />
      </Screen>
    );
  }

  if (settingsQuery.isError) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Настройки календаря" />
        <EmptyState
          state="error"
          fill
          subtitle={
            settingsQuery.error instanceof Error
              ? settingsQuery.error.message
              : undefined
          }
          action={{
            label: "Повторить",
            onPress: () => void settingsQuery.refetch(),
          }}
        />
      </Screen>
    );
  }

  return (
    <Screen edges={["top"]}>
      {/* Шов под шапкой один — его несёт лента чипов. */}
      <ScreenHeader
        // Шапка — «Настройки …», как у шестерёнок клиентов и финансов.
        title="Настройки календаря"
        // Шов несёт лента чипов, но при нуле календарей она не рисуется —
        // тогда линию берёт на себя шапка, иначе она висит в воздухе.
        seam={teams.length === 0}
        right={<SavedIndicator tick={savedTick} />}
      />
      {/* КОМАНДЫ СВЕРХУ, КАК ВЕЗДЕ: те же чипы, что в календаре и в финансах, и
          настройки каждой команды правятся не выходя с экрана. */}
      <CalendarChipsBar screen={screen} />
      {rows.any || canLeave ? (
        <TourScrollProvider scrollRef={scrollRef} scrollY={scrollY}>
        <ScrollView
          ref={scrollRef}
          className="flex-1"
          contentContainerStyle={{ paddingBottom: 32 }}
          scrollEventThrottle={16}
          onScroll={(e) => {
            scrollY.current = e.nativeEvent.contentOffset.y;
          }}
        >
          {team ? <CalendarTeamRows screen={screen} team={team} /> : null}

          <CalendarReferenceRows screen={screen} />

          <CalendarExitRows screen={screen} />

          {/* Календарей нет — общее пустое состояние, одной строкой (канон
              пустых): дверь «Добавить» стоит в ленте над ним. */}
          {teams.length === 0 ? <EmptyState title="Календарей пока нет" /> : null}
        </ScrollView>
        </TourScrollProvider>
      ) : (
        // Строк не открыли ни одной: страница остаётся собой, а тело
        // говорит одной строкой — без подписи и без кнопки (канон пустых
        // состояний, канон).
        <EmptyState fill title="Настроек пока нет" />
      )}

      <CalendarSettingsSheets screen={screen} />
    </Screen>
  );
}
