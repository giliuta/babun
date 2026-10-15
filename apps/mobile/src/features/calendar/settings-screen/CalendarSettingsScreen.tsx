import { ScrollView, Text } from "react-native";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { useThemeColors } from "@/theme/colors";
import { SavedIndicator } from "@/features/calendar/SavedIndicator";
import { CalendarChipsBar } from "./CalendarChipsBar";
import { CalendarExitRows } from "./CalendarExitRows";
import { CalendarReferenceRows } from "./CalendarReferenceRows";
import { CalendarSettingsSheets } from "./CalendarSettingsSheets";
import { CalendarTeamRows } from "./CalendarTeamRows";
import { useCalendarSettingsScreen } from "./use-calendar-settings-screen";

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
  const t = useThemeColors();
  const screen = useCalendarSettingsScreen();
  const { settingsQuery, teams, teamsLoading, savedTick, team, rows, canLeave } = screen;

  if (teamsLoading || settingsQuery.isLoading) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Календарь" />
        <EmptyState state="loading" fill />
      </Screen>
    );
  }

  if (settingsQuery.isError) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Календарь" />
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
        title="Календарь"
        // Шов несёт лента чипов, но при нуле календарей она не рисуется —
        // тогда линию берёт на себя шапка, иначе она висит в воздухе.
        seam={teams.length === 0}
        right={<SavedIndicator tick={savedTick} />}
      />
      {/* КОМАНДЫ СВЕРХУ, КАК ВЕЗДЕ: те же чипы, что в календаре и в финансах, и
          настройки каждой команды правятся не выходя с экрана. */}
      <CalendarChipsBar screen={screen} />
      {rows.any || canLeave ? (
        <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 32 }}>
          {team ? <CalendarTeamRows screen={screen} team={team} /> : null}

          <CalendarReferenceRows screen={screen} />

          <CalendarExitRows screen={screen} />

          {teams.length === 0 ? (
            <SectionCard>
              <Text
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 14,
                  fontSize: 15,
                  color: t.faint,
                }}
              >
                {rows.addCalendar
                  ? "Календарей пока нет — создайте первый на вкладке «Календарь»."
                  : "Календарей пока нет."}
              </Text>
            </SectionCard>
          ) : null}
        </ScrollView>
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
