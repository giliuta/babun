import { type ReactNode } from "react";
import { View } from "react-native";
import { useSafeAreaInsets, type Edge } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useThemeColors } from "@/theme/colors";

// Base screen wrapper. Holds the flex/bg and the safe-area padding (NativeWind
// v5 className doesn't apply to wrapper components yet, so the wrapper uses
// inline style ONCE here, driven by the theme). The inner View is a core RN
// component → className works, so callers style content via `className`.
export function Screen({
  children,
  className = "",
  edges,
  bg,
}: {
  children: ReactNode;
  className?: string;
  edges?: readonly Edge[];
  /** Ground colour override (defaults to the neutral canvas). The booking
   *  screen feeds it a soft identity wash so the whole page — including the
   *  top safe area — lifts in the appointment's colour. */
  bg?: string;
}) {
  const t = useThemeColors();
  // ОТСТУПЫ СЧИТАЕМ ПО КОНТЕКСТУ, А НЕ `SafeAreaView` (2026-08-17). Внутри
  // нативной `Modal` (выбор услуги, выбор клиента, полноэкранные листы)
  // `SafeAreaView` меряет СВОЁ окно и даёт ноль сверху: шапка уезжала под
  // статус-бар — заголовок прятался за «островом», а «Готово» вставало вровень
  // с часами. Значения инсетов приходят по React-дереву и внутри модалки живы,
  // поэтому падинги ставим руками. Владелец поймал это на выборе услуги:
  // «кнопка „Готово“ хуй знает куда упала».
  const insets = useSafeAreaInsets();
  const on = (edge: Edge) => !edges || edges.includes(edge);
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: bg ?? t.canvas,
        paddingTop: on("top") ? insets.top : 0,
        paddingBottom: on("bottom") ? insets.bottom : 0,
        paddingLeft: on("left") ? insets.left : 0,
        paddingRight: on("right") ? insets.right : 0,
      }}
    >
      <StatusBar style={t.statusBar} />
      <View className={`flex-1 ${className}`}>{children}</View>
    </View>
  );
}
