import { Stack } from "expo-router";
import { DashboardGate } from "@/lib/DashboardGate";
import { useThemeColors } from "@/theme/colors";
import { RoleCapabilityBoundary } from "@/features/settings/RoleCapabilityBoundary";

// Хаб документов — сиблинг табов (как /invoices и /accounts): «назад»
// всегда возвращает позвавшему.
export default function DocumentsLayout() {
  const t = useThemeColors();
  return (
    <DashboardGate>
      <RoleCapabilityBoundary capability="view-finances" title="Документы">
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
