import { Pressable, Text } from "react-native";
import { ChevronLeft } from "lucide-react-native";

import { useThemeColors } from "@/theme/colors";

/** «Назад» ВТОРОГО ШАГА ЛИСТА. Выбор внутри листа приезжает вторым шагом того
 *  же листа — лист поверх листа iOS не покажет (`BottomSheet` — RN Modal). Так
 *  выбирают счёт и день перевода и язык бумаги инвойса; строка возврата у них
 *  одна. */
export function StepBack({ onPress }: { onPress: () => void }) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Назад"
      hitSlop={8}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 2,
        alignSelf: "flex-start",
        minHeight: 44,
        paddingRight: 12,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <ChevronLeft color={t.accent} size={20} strokeWidth={2.2} />
      <Text style={{ fontSize: 15, fontWeight: "600", color: t.accent }}>Назад</Text>
    </Pressable>
  );
}
