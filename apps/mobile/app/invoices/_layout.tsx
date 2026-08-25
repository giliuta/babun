import { Stack } from "expo-router";
import { DashboardGate } from "@/lib/DashboardGate";
import { useThemeColors } from "@/theme/colors";
import { RoleCapabilityBoundary } from "@/features/settings/RoleCapabilityBoundary";

export default function InvoicesLayout() {
  const t = useThemeColors();
  return (
    <DashboardGate>
      <RoleCapabilityBoundary capability="view-finances" title="Инвойсы">
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
