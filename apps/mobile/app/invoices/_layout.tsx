import type { ReactNode } from "react";
import { Stack } from "expo-router";
import { DashboardGate } from "@/lib/DashboardGate";
import { useThemeColors } from "@/theme/colors";
import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { RoleCapabilityBoundary } from "@/features/settings/RoleCapabilityBoundary";
import { useFeatureOn } from "@/features/settings/company-features";

export default function InvoicesLayout() {
  const t = useThemeColors();
  return (
    <DashboardGate>
      <RoleCapabilityBoundary capability="view-finances" title="Инвойсы">
        <DocumentsFeatureGate>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: t.canvas },
            }}
          />
        </DocumentsFeatureGate>
      </RoleCapabilityBoundary>
    </DashboardGate>
  );
}

/** «Инвойсы и чеки» выключены у компании (STORY-088): все двери к ним уже
 *  спрятаны, а прямая ссылка на инвойс говорит словами, где это включается,
 *  — без кнопки внутри (владелец 15.09: пустые состояния — только слова). */
function DocumentsFeatureGate({ children }: { children: ReactNode }) {
  const documentsOn = useFeatureOn("documents");
  if (documentsOn) return <>{children}</>;
  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Инвойсы" />
      <EmptyState
        fill
        title="Инвойсы и чеки выключены"
        subtitle="Включаются в настройках финансов"
      />
    </Screen>
  );
}
