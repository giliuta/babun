import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { TYPE } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";

// ШАПКА ДНЯ НАД ПЛАШКАМИ — ОДНА НА ВСЕ ЛЕНТЫ. Капс-подпись caption 11/700
// (DS §2 называет её прямо: «UPPERCASE eyebrows, day dividers»), как у
// подписи блока `SectionCard` на тех же экранах. Каждая вкладка набирала
// свою — 12/600 из одного старого образца — и шапки дней стояли крупнее и
// тоньше соседних подписей.
//
// Справа — необязательный слот (итог дня в ленте «Финансов»). `background`
// нужен шапке, которая липнет поверх списка.
export function DayDivider({
  label,
  right,
  background,
}: {
  label: string;
  right?: ReactNode;
  background?: string;
}) {
  const t = useThemeColors();
  return (
    <View
      className="flex-row items-center justify-between px-4 pb-1.5 pt-3"
      style={background ? { backgroundColor: background } : undefined}
    >
      <Text
        maxFontSizeMultiplier={1.3}
        style={{ ...TYPE.caption, textTransform: "uppercase", color: t.sub }}
      >
        {label}
      </Text>
      {right}
    </View>
  );
}
