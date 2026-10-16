import { createContext, useContext, type ReactNode } from "react";
import { Platform, View } from "react-native";
import { useSafeAreaInsets, type Edge } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useThemeColors } from "@/theme/colors";

// НАД ТАБАМИ ЛИ ЭКРАН. Экраны вкладок берут только верх
// (`edges={["top"]}`): низ закрывает таб-бар. Те же экраны живут и над табами
// — группы `(shared)`, инвойсы, чеки, — где таб-бара нет, и подвал («Создать
// услугу», «Выставить») ложился под «Назад / Домой» Android. Стек такой группы
// говорит это экрану контекстом, и низ экран берёт сам — ровно один раз:
// отступ, поставленный стеком поверх, удваивался у экранов, которые над табами
// и так берут низ (карточка клиента: визиты, SMS, объекты). На iOS вид прежний.
const OverTabsContext = createContext(false);
export const OverTabs = OverTabsContext.Provider;

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
  // ОТСТУПЫ СЧИТАЕМ ПО КОНТЕКСТУ, А НЕ `SafeAreaView`. Внутри
  // нативной `Modal` (выбор услуги, выбор клиента, полноэкранные листы)
  // `SafeAreaView` меряет СВОЁ окно и даёт ноль сверху: шапка уезжала под
  // статус-бар — заголовок прятался за «островом», а «Готово» вставало вровень
  // с часами. Значения инсетов приходят по React-дереву и внутри модалки живы,
  // поэтому падинги ставим руками.
  const insets = useSafeAreaInsets();
  const overTabs = useContext(OverTabsContext) && Platform.OS === "android";
  const on = (edge: Edge) => !edges || edges.includes(edge) || (edge === "bottom" && overTabs);
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
