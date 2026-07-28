import { Stack } from "expo-router";
import { DashboardGate } from "@/lib/DashboardGate";
import { useThemeColors } from "@/theme/colors";
import { RoleCapabilityBoundary } from "@/features/settings/RoleCapabilityBoundary";

// Счета живут НАД табами (как /invoices): «назад» возвращает ровно туда,
// откуда пришли — со страницы финансов, из кабинета или из инвойса, —
// а не в корень вкладки «Кабинет».
export default function AccountsLayout() {
  const t = useThemeColors();
  return (
    <DashboardGate>
      <RoleCapabilityBoundary capability="view-finances" title="Счета">
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
