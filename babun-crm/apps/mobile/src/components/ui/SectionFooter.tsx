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
        paddingHorizontal: 16,
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
