import { Stack } from "expo-router";
import { DashboardGate } from "@/lib/DashboardGate";
import { useThemeColors } from "@/theme/colors";
import { EmptyState } from "@/components/ui/EmptyState";
import { OverTabs, Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { RoleCapabilityBoundary } from "@/features/settings/RoleCapabilityBoundary";
import { useCurrentRole } from "@/session/tenant";
import { useDocumentLevel } from "@/session/document-rights";

// Хаб документов — сиблинг табов (как /invoices и /accounts): «назад»
// всегда возвращает позвавшему.
//
// ПАРТНЁР С «ДОКУМЕНТЫ: ВИДИТ» ОТКРЫВАЕТ ЧЕК (видит и смотрит, но отправлять не может), как уже
// открывает инвойс (`invoices/_layout.tsx`). Что на странице можно сделать,
// решает она сама (`ReceiptPage`); какие чеки видны, режет сервер.
export default function DocumentsLayout() {
  const t = useThemeColors();
  const role = useCurrentRole().data;
  const level = useDocumentLevel();
  const stack = (
    // Над табами: подвалы документов («Выставить», «Оформить возврат») —
    // над навигацией Android, низ берёт сам `Screen`.
    <OverTabs value>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: t.canvas },
        }}
      />
    </OverTabs>
  );
  if (role === "master") {
    return (
      <DashboardGate>
        {level === "read" || level === "write" ? (
          stack
        ) : level === "loading" ? (
          <Screen edges={["top"]}>
            <ScreenHeader title="Документы" />
            <EmptyState state="loading" fill />
          </Screen>
        ) : (
          <Screen edges={["top"]}>
            <ScreenHeader title="Документы" />
            <EmptyState fill title="Документов пока нет" />
          </Screen>
        )}
      </DashboardGate>
    );
  }
  return (
    <DashboardGate>
      <RoleCapabilityBoundary capability="view-finances" title="Документы">
        {stack}
      </RoleCapabilityBoundary>
    </DashboardGate>
  );
}
