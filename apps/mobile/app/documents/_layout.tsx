import { Platform } from "react-native";
import { Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DashboardGate } from "@/lib/DashboardGate";
import { useThemeColors } from "@/theme/colors";
import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { RoleCapabilityBoundary } from "@/features/settings/RoleCapabilityBoundary";
import { useCurrentRole } from "@/features/settings/tenant";
import { useDocumentLevel } from "@/features/documents/document-rights";

// Хаб документов — сиблинг табов (как /invoices и /accounts): «назад»
// всегда возвращает позвавшему.
//
// ПАРТНЁР С «ДОКУМЕНТЫ: ВИДИТ» ОТКРЫВАЕТ ЧЕК (владелец 04.10: «если видит —
// может их видеть, нажимать посмотреть, но отправлять не может»), как уже
// открывает инвойс (`invoices/_layout.tsx`). Что на странице можно сделать,
// решает она сама (`ReceiptPage`); какие чеки видны, режет сервер.
export default function DocumentsLayout() {
  const t = useThemeColors();
  const insets = useSafeAreaInsets();
  const role = useCurrentRole().data;
  const level = useDocumentLevel();
  const stack = (
    <Stack
      screenOptions={{
        headerShown: false,
        // Низ — над навигацией Android: подвалы документов («Выставить»,
        // «Оформить возврат») стоят у экранов `edges={["top"]}` и над табами
        // ложились под «Назад / Домой» (13.10). На iOS вид прежний.
        contentStyle: {
          backgroundColor: t.canvas,
          paddingBottom: Platform.OS === "android" ? insets.bottom : 0,
        },
      }}
    />
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
