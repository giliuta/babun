import { Stack } from "expo-router";
import { useThemeColors } from "@/theme/colors";
import { RoleCapabilityBoundary } from "@/features/settings/RoleCapabilityBoundary";

// Настройки календаря. Живут ВНУТРИ вкладки «Календарь» (app/(dashboard)/
// (home)), поэтому таб-бар остаётся на месте, а вкладка помнит, на какой
// странице настроек её оставили.
//
// Две ступени, канон iOS Settings → Почта:
//   /calendar          — общее для всех календарей + список календарей
//   /calendar/labels   — метки дня
//   /calendar/services — прайс команды
//
// Ступень навигации = ОБЛАСТЬ ДЕЙСТВИЯ: на экране команды нет ни одного
// контрола, пишущего в общие настройки, поэтому «правлю Ремонт, а меняется
// у Отделки» невозможно физически, а не по договорённости.
//
// Сессию и тенанта гейтит DashboardGate из ../../_layout.tsx — здесь остаётся
// только право на сами настройки.
export default function CalendarSettingsLayout() {
  const t = useThemeColors();
  return (
    <RoleCapabilityBoundary capability="manage-calendar-settings" title="Календарь">
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: t.canvas },
        }}
      />
    </RoleCapabilityBoundary>
  );
}
