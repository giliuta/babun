import { Text } from "react-native";
import { useThemeColors } from "@/theme/colors";

// Заголовок группы НА канвасе (диалект grouped-iOS): caption-tier caps над
// карточкой, а не первой строкой внутри неё. Пара к SectionFooter — eyebrow
// называет группу сверху, footer растолковывает снизу; оба на одной левой
// базовой линии (20), чтобы колонка читалась как одна.
//
// Единственный дом рецепта: до этого он жил пятью копиями по экранам
// (настройки календаря, cabinet/close-day, teams/[id], + два GroupLabel с
// другими отступами) и уже начал расходиться.
export function SectionEyebrow({ children }: { children: string }) {
  const t = useThemeColors();
  return (
    <Text
      accessibilityRole="header"
      style={{
        paddingHorizontal: 20,
        paddingTop: 24,
        paddingBottom: 8,
        fontSize: 11,
        fontWeight: "700",
        letterSpacing: 0.6,
        textTransform: "uppercase",
        color: t.faint,
      }}
    >
      {children}
    </Text>
  );
}
