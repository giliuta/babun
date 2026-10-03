import { Stack } from "expo-router";
import { DashboardGate } from "@/lib/DashboardGate";
import { useThemeColors } from "@/theme/colors";
import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { RoleCapabilityBoundary } from "@/features/settings/RoleCapabilityBoundary";
import { useCurrentRole } from "@/features/settings/tenant";
import { useFinanceSettingLevelsOf } from "@/features/finances/use-finance-settings";
import { useTeams } from "@/features/reference/queries";

// Счета живут НАД табами (как /invoices): «назад» возвращает ровно туда,
// откуда пришли — со страницы финансов, из кабинета или из инвойса, —
// а не в корень вкладки «Кабинет».
//
// ДВЕРЬ (03.10): владельцу — как было (граница роли); партнёру — если хоть в
// одной команде у него открыта строка шестерёнки «Счета». Что именно он
// видит и правит, решает сама страница (`accounts/settings.tsx`).
export default function AccountsLayout() {
  const t = useThemeColors();
  const role = useCurrentRole().data;
  const levelsOf = useFinanceSettingLevelsOf();
  const teams = useTeams().data ?? [];
  const stack = (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: t.canvas },
      }}
    />
  );
  if (role === "master") {
    const open = teams.some((team) => levelsOf(team.id).accounts !== "hidden");
    return (
      <DashboardGate>
        {open ? (
          stack
        ) : (
          <Screen edges={["top"]}>
            <ScreenHeader title="Счета" />
            <EmptyState fill title="Настроек пока нет" />
          </Screen>
        )}
      </DashboardGate>
    );
  }
  return (
    <DashboardGate>
      <RoleCapabilityBoundary capability="view-finances" title="Счета">
        {stack}
      </RoleCapabilityBoundary>
    </DashboardGate>
  );
}
