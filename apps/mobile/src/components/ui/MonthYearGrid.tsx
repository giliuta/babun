import { Pressable, Text, View } from "react-native";
import { TYPE } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";

// БЫСТРЫЙ ПРЫЖОК К ГОДУ И МЕСЯЦУ. Листать месяцы по одному до записи двухлетней
// давности — двадцать с лишним свайпов; здесь это два тапа: год, затем месяц.
// Годы — ряд ближайших (три назад, следующий), дальние — стрелками шапки, что
// стоит над решёткой у того, кто её показывает. Решётка общая для календаря и
// для периода «Финансов»: прыжок по времени выглядит одинаково везде.

/** Годы ряда: три назад, текущий и следующий — ввод истории и запись вперёд. */
export function quickYears(todayYear: number): number[] {
  return [todayYear - 3, todayYear - 2, todayYear - 1, todayYear, todayYear + 1];
}

/** Короткие имена месяцев на языке интерфейса, без точки сокращения. */
function shortMonth(month: number): string {
  return new Date(2000, month, 1)
    .toLocaleDateString("ru-RU", { month: "short" })
    .replace(/\.$/, "");
}

export function MonthYearGrid({
  year,
  month,
  todayYear,
  todayMonth,
  width,
  onYear,
  onMonth,
}: {
  /** Год, месяцы которого показаны. */
  year: number;
  /** Выбранный сейчас месяц этого года (подсветка); −1 — ни один. */
  month: number;
  todayYear: number;
  todayMonth: number;
  /** Ширина содержимого — решётка делит её без остатка. */
  width: number;
  onYear: (year: number) => void;
  onMonth: (month: number) => void;
}) {
  const t = useThemeColors();
  const years = quickYears(todayYear);
  const yearW = Math.floor(width / years.length);
  const monthW = Math.floor(width / 3);
  return (
    <View style={{ width }}>
      <View style={{ flexDirection: "row", marginBottom: 8 }}>
        {years.map((y) => {
          const on = y === year;
          return (
            <Pressable
              key={y}
              onPress={() => onYear(y)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${y} год`}
              style={{ width: yearW, padding: 2 }}
            >
              {({ pressed }) => (
                <View
                  style={{
                    height: 36,
                    borderRadius: t.radius.card,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: on ? t.accent : pressed ? t.pressed : t.rowFill,
                  }}
                >
                  <Text
                    maxFontSizeMultiplier={1.2}
                    style={{
                      ...TYPE.callout,
                      fontWeight: "700",
                      fontVariant: ["tabular-nums"],
                      color: on ? t.onAccent : y === todayYear ? t.accent : t.ink,
                    }}
                  >
                    {y}
                  </Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        {Array.from({ length: 12 }, (_, m) => {
          const on = m === month;
          const now = year === todayYear && m === todayMonth;
          return (
            <Pressable
              key={m}
              onPress={() => onMonth(m)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={new Date(year, m, 1).toLocaleDateString("ru-RU", {
                month: "long",
                year: "numeric",
              })}
              style={{ width: monthW, padding: 3 }}
            >
              {({ pressed }) => (
                <View
                  style={{
                    height: 44,
                    borderRadius: t.radius.card,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: on
                      ? `${t.accent}1a`
                      : pressed
                        ? t.pressed
                        : "transparent",
                  }}
                >
                  <Text
                    maxFontSizeMultiplier={1.2}
                    style={{
                      ...TYPE.body,
                      fontWeight: on || now ? "700" : "500",
                      textTransform: "capitalize",
                      color: on || now ? t.accent : t.ink,
                    }}
                  >
                    {shortMonth(m)}
                  </Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
