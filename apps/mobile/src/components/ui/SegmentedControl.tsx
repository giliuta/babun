import { Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

export type SegmentOption<V extends string> = {
  value: V;
  label: string;
  /** Active label hue — e.g. danger for «Расход», success for «Доход». */
  color?: string;
};

// «Halo Cobalt» segmented control — the ONE recipe for every inline
// single-choice segment (operation type, «С | До», kind toggles): t.fill
// track, surface thumb, semibold labels tinted per option when active.
export function SegmentedControl<V extends string>({
  options,
  value,
  onChange,
  disabled,
  compact,
  style,
}: {
  options: readonly SegmentOption<V>[];
  value: V;
  onChange: (v: V) => void;
  /** Locks the control (e.g. type of an existing operation). */
  disabled?: boolean;
  /** ПЛОТНЫЙ — В ХВОСТЕ СТРОКИ (страница прав, STORY-087): тот же сегмент, но
   *  ячейка 36 (с дорожкой — 44, норма касания) и кегль 13. Во всю ширину под
   *  строкой он делал строку права высотой ~150pt. */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useThemeColors();
  return (
    <View
      accessibilityRole="radiogroup"
      style={[
        {
          flexDirection: "row",
          borderRadius: t.radius.card,
          padding: compact ? 3 : 4,
          backgroundColor: t.fill,
        },
        style,
      ]}
    >
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <Pressable
            key={opt.value}
            disabled={disabled}
            onPress={() => {
              // ТИК ЗАПЕЧЁН В ПРИМИТИВ. Сегмент — дискретный выбор, и канон
              // требует отклика в палец на каждом; без него самое весомое
              // действие страницы прав («Меняет» → «Скрыт» для денег) молчит,
              // хотя фильтр-чип рядом тикает.
              // Тик — на СМЕНУ, а не на касание: повторный тап по уже
              // выбранному ничего не меняет, и отклик на него читается как
              // «что-то произошло».
              if (!active) haptics.tap();
              onChange(opt.value);
            }}
            accessibilityRole="radio"
            accessibilityLabel={opt.label}
            accessibilityState={{ selected: active, disabled: !!disabled }}
            style={{
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: t.radius.card,
              paddingVertical: compact ? 4 : 8,
              paddingHorizontal: compact ? 6 : 0,
              minHeight: compact ? 38 : 44,
              backgroundColor: active ? t.surface : "transparent",
              opacity: disabled && !active ? 0.4 : 1,
            }}
          >
            <Text
              maxFontSizeMultiplier={1.3}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.75}
              style={{
                fontSize: compact ? 13 : 15,
                fontWeight: "600",
                color: active ? (opt.color ?? t.ink) : t.sub,
              }}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
