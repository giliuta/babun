import { Pressable, Text, View } from "react-native";
import { useThemeColors } from "@/theme/colors";

// СКОЛЬКО РАЗ ВЗЯЛИ УСЛУГУ — ОТТИСКОМ «×3» (владелец 2026-09-04, выбрал из
// четырёх вариантов на экране сравнения: «понравился первый вариант, когда
// там икс три написано»).
//
// Стрелок вверх/вниз больше нет: в списке услуг количество набирают ТАПАМИ по
// строке (+1), а тап по самому бейджу убавляет (−1, ноль убирает услугу).
// Бейдж чёрный, как «оттиск» выбранного в фильтрах: выбранность несёт
// заливка, а не галка. В форме записи он только ПОКАЗЫВАЕТ число — там тап по
// строке открывает список.
//
// Единица услуги («4 м») важнее знака умножения: бригадир, читая строку,
// обязан видеть, метры это или разы.

export function QtyBadge({
  qty,
  unit,
  onPress,
  tone = "stamp",
}: {
  qty: number;
  unit?: string | null;
  /** Тап убавляет. Без него бейдж — просто подпись (форма записи). */
  onPress?: () => void;
  /** `stamp` — чернильный оттиск выбранного (список услуг). `quiet` —
   *  подложка `fill` и чернильная цифра: на странице записи бейдж лишь
   *  называет число, и чёрное пятно там было громче итога (аудит
   *  2026-09-06, владелец согласился со всеми волнами). */
  tone?: "stamp" | "quiet";
}) {
  const t = useThemeColors();
  const label = unit ? `${qty} ${unit}` : `×${qty}`;
  const quiet = tone === "quiet";
  const body = (
    <View
      className="items-center justify-center rounded-[10px]"
      style={{
        minWidth: 40,
        height: 28,
        paddingHorizontal: 8,
        backgroundColor: quiet ? t.fill : t.ink,
      }}
    >
      <Text
        maxFontSizeMultiplier={1.2}
        style={{
          fontSize: 14,
          fontWeight: "700",
          color: quiet ? t.ink : t.onAccent,
          fontVariant: ["tabular-nums"],
        }}
      >
        {label}
      </Text>
    </View>
  );
  if (!onPress) {
    return (
      <View accessibilityLabel={`Количество: ${label}`} className="mr-3">
        {body}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={`Количество: ${label}. Убавить`}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      {body}
    </Pressable>
  );
}
