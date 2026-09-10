import { Pressable, View } from "react-native";
import { readableTextOnColor } from "@/components/ui/color-contrast";
import { useThemeColors } from "@/theme/colors";
import { ICON_PRESETS, type IconPreset } from "./icon-set";
import { PICKER_COLUMNS, PICKER_GAP, PICKER_RADIUS } from "./picker-grid";

// Блок выбора ЗНАЧКА — брат-близнец `ColorPicker`: та же решётка квадратов, тот
// же зазор (`picker-grid`), потому что оба живут в ОДНОЙ шторке под общим
// переключателем «Значок · Цвет» и отвечают на один вопрос — «как узнать это в
// списке» (владелец 2026-09-10: «сделать 40 иконок, то же самое, что цвет…
// сразу переключатель — иконка или цвет»).
//
// Выбранное — плитка, залитая цветом сущности; глиф на ней берёт читаемый тон.
// Незанятые стоят на тихой подложке `fill`: сорок ярких плиток спорили бы с
// решёткой цветов на соседней вкладке, а вопрос здесь другой.
const GLYPH = 22;

export function IconPicker({
  value,
  onChange,
  tint,
  icons,
  disabled,
}: {
  value: string | null | undefined;
  /** Слаг нажатого значка. Снятие выбора решает вызывающий: он знает `value`. */
  onChange: (slug: string) => void;
  /** Цвет заливки выбранного — обычно цвет самой сущности. */
  tint?: string | null;
  /** Набор-переопределение; по умолчанию общие сорок. */
  icons?: readonly IconPreset[];
  disabled?: boolean;
}) {
  const t = useThemeColors();
  const set = icons ?? ICON_PRESETS;
  const fill = tint ?? t.accent;

  return (
    <View
      accessibilityRole="radiogroup"
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        marginHorizontal: -PICKER_GAP / 2,
      }}
    >
      {set.map(({ value: slug, label: name, icon: Glyph }) => {
        const selected = value === slug;
        return (
          <Pressable
            key={slug}
            onPress={disabled ? undefined : () => onChange(slug)}
            disabled={disabled}
            accessibilityRole="radio"
            accessibilityLabel={`Значок ${name}`}
            accessibilityState={{ selected, disabled: !!disabled }}
            style={({ pressed }) => ({
              width: `${100 / PICKER_COLUMNS}%`,
              aspectRatio: 1,
              padding: PICKER_GAP / 2,
              opacity: pressed ? 0.7 : disabled ? 0.4 : 1,
            })}
          >
            <View
              style={{
                flex: 1,
                borderRadius: PICKER_RADIUS,
                borderCurve: "continuous",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: selected ? fill : t.fill,
              }}
            >
              <Glyph
                color={
                  selected ? readableTextOnColor(fill, t.ink, "#FFFFFF") : t.body
                }
                size={GLYPH}
                strokeWidth={2}
              />
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
