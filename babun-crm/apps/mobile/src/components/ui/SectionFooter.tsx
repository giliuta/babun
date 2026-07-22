import { Text } from "react-native";
import { useThemeColors } from "@/theme/colors";

// Футнот секции (паттерн iOS Settings): тихий caption под карточкой или
// группой контролов — объясняет поведение настройки там, где одной подписи
// строки мало. Пара к SectionEyebrow: eyebrow называет группу сверху,
// footer растолковывает снизу.
export function SectionFooter({ children }: { children: string }) {
  const t = useThemeColors();
  return (
    <Text
      style={{
        // 20 = левая базовая линия SectionEyebrow: заголовок над карточкой и
        // футнот под ней стоят в одной колонке. На 16 они расходились, и
        // группа читалась как два случайно соседствующих текста.
        paddingHorizontal: 20,
        paddingTop: 6,
        paddingBottom: 2,
        fontSize: 13,
        lineHeight: 17,
        color: t.faint,
      }}
    >
      {children}
    </Text>
  );
}
