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
}: {
  qty: number;
  unit?: string | null;
  /** Тап убавляет. Без него бейдж — просто подпись (форма записи). */
  onPress?: () => void;
}) {
  const t = useThemeColors();
  const label = unit ? `${qty} ${unit}` : `×${qty}`;
  // ТИХАЯ ПИЛЮЛЯ ВЕЗДЕ (владелец 2026-09-06, после аудита: «в услугах опять
  // осталась чёрная штука»): подложка fill и чернильная цифра — и на странице
  // записи, и в списке услуг. Выбранность в списке несёт само наличие
  // числа, чёрная заливка была громче всего экрана.
  const body = (
    <View
      className="items-center justify-center rounded-[10px]"
      style={{
        minWidth: 40,
        height: 28,
        paddingHorizontal: 8,
        backgroundColor: t.fill,
      }}
    >
      <Text
        maxFontSizeMultiplier={1.2}
        style={{
          fontSize: 14,
          fontWeight: "700",
          color: t.ink,
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
