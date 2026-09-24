import type { ReactNode } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ChoiceSheetHost } from "@/components/ui/ChoiceSheet";
import { ToastProvider } from "@/components/ui/Toast";

// ОБЁРТКА ДЛЯ CLAUDE DESIGN — то же окружение, в котором блоки живут в
// приложении (`app/_layout.tsx` → `AppProviders`): жесты (свайпы строк,
// шторки), безопасные отступы (шторки и экраны читают вырез и «домашнюю
// полоску»), тосты и шторки выбора. Без неё свайп, шторка и тост падают с
// «нет провайдера». Данных приложения (сессия, запросы) здесь нет намеренно:
// блоки — только вид, данные им передают пропами.
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

export function BabunProvider({ children }: { children: ReactNode }) {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider initialMetrics={METRICS}>
        <ToastProvider>
          <ChoiceSheetHost>{children}</ChoiceSheetHost>
        </ToastProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
