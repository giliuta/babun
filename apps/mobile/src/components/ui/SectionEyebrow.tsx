import { Text } from "react-native";
import { useThemeColors } from "@/theme/colors";
import { capsText } from "./caps-text";

// Заголовок группы НА канвасе (диалект grouped-iOS): caption-tier caps над
// карточкой, а не первой строкой внутри неё. Левая базовая линия 20.
//
// ПАРЫ «FOOTER» У НЕГО БОЛЬШЕ НЕТ: объясняшки под карточками убраны из продукта
// целиком вместе с примитивом `SectionFooter` (DS §5).
// Группу НАЗЫВАЮТ сверху — и на этом всё; растолковывать её снизу абзацем
// запрещено.
//
// Единственный дом рецепта: до этого он жил пятью копиями по экранам
// (настройки календаря, teams/[id], + два GroupLabel с
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
        // ИМЯ ГРУППЫ — ПОЛНЫЙ ЧЁРНЫЙ (DS §1 «серого нет»): оно называет
        // раздел. Тише — подпись строки (13/500 `t.sub`), а не название.
        color: t.ink,
      }}
    >
      {capsText(children)}
    </Text>
  );
}
