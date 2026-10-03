import type { ReactNode } from "react";
import { Stack } from "expo-router";
import { DashboardGate } from "@/lib/DashboardGate";
import { useThemeColors } from "@/theme/colors";
import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { RoleCapabilityBoundary } from "@/features/settings/RoleCapabilityBoundary";
import { useFeatureOn } from "@/features/settings/company-features";
import { useCurrentRole } from "@/features/settings/tenant";
import { accessGate } from "@/features/access/my-access";
import { useMyAccess } from "@/features/access/queries";
import { useTeams } from "@/features/reference/queries";

// ДВЕРЬ (03.10): владельцу — как было (граница роли); партнёру — если хоть в
// одной команде у него «Документы: Видит». Какие инвойсы он видит, режет
// сервер (`invoices_select_documents`); что на странице можно сделать —
// решает сама страница (`[id].tsx`), кому выставлять — `new.tsx`.
export default function InvoicesLayout() {
  const t = useThemeColors();
  const role = useCurrentRole().data;
  const myAccess = useMyAccess().data;
  const teams = useTeams().data ?? [];
  const stack = (
    <DocumentsFeatureGate>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: t.canvas },
        }}
      />
    </DocumentsFeatureGate>
  );
  if (role === "master") {
    const open = teams.some(
      (team) =>
        accessGate({ role, map: myAccess, blockKey: "finance.documents", scope: "calendar", teamId: team.id }) !==
        "locked",
    );
    return (
      <DashboardGate>
        {open ? (
          stack
        ) : (
          <Screen edges={["top"]}>
            <ScreenHeader title="Инвойсы" />
            <EmptyState fill title="Документов пока нет" />
          </Screen>
        )}
      </DashboardGate>
    );
  }
  return (
    <DashboardGate>
      <RoleCapabilityBoundary capability="view-finances" title="Инвойсы">
        {stack}
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
