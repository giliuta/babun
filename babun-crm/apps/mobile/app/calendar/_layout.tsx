import { Stack } from "expo-router";
import { useThemeColors } from "@/theme/colors";
import { DashboardGate } from "@/lib/DashboardGate";
import { RoleCapabilityBoundary } from "@/features/settings/RoleCapabilityBoundary";

// Настройки календаря. Группа лежит в КОРНЕВОМ стеке (сиблинг табов), чтобы
// шестерёнка с вкладки «Календарь» открывала их поверх таб-бара, а не
// переключала пользователя на вкладку «Кабинет».
//
// Две ступени, канон iOS Settings → Почта:
//   /calendar                  — общее для всех календарей + список календарей
//   /calendar/[teamId]         — этот календарь
//   /calendar/[teamId]/schedule — его рабочий график
//
// Ступень навигации = ОБЛАСТЬ ДЕЙСТВИЯ: на экране команды нет ни одного
// контрола, пишущего в общие настройки, поэтому «правлю Ремонт, а меняется
// у Отделки» невозможно физически, а не по договорённости.
export default function CalendarSettingsLayout() {
  const t = useThemeColors();
  return (
    <DashboardGate>
      <RoleCapabilityBoundary capability="manage-calendar-settings" title="Календарь">
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: t.canvas },
          }}
        />
      </RoleCapabilityBoundary>
    </DashboardGate>
  );
}
