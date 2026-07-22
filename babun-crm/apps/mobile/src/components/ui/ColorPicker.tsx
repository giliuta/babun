import { Pressable, Text, View } from "react-native";
import {
  PRESET_COLORS,
  type ColorPreset,
} from "@babun/shared/common/utils/colors";
import { useThemeColors } from "@/theme/colors";

// «Halo Cobalt» colour picker — the ONE swatch grid for every user-picked
// colour (команды / метки / услуги / категории услуг / типы событий /
// категории финансов). Palette = the shared PRESET_COLORS (web parity:
// TEAM_COLORS is an alias of it), 36pt swatch + hitSlop to a 44pt target,
// radio semantics with the Russian colour name for VoiceOver.
export function ColorPicker({
  value,
  onChange,
  label = "Цвет",
  colors,
  disabled,
}: {
  value: string | null | undefined;
  onChange: (hex: string) => void;
  /** Eyebrow above the swatches; pass null to render none. */
  label?: string | null;
  /** Palette override (hex values) — defaults to the shared PRESET_COLORS. */
  colors?: readonly string[];
  disabled?: boolean;
}) {
  const t = useThemeColors();
  const palette: ColorPreset[] = colors
    ? colors.map(
        (v) =>
          PRESET_COLORS.find(
            (p) => p.value.toLowerCase() === v.toLowerCase(),
          ) ?? { name: v, value: v },
      )
    : [...PRESET_COLORS];

  return (
    <View className="mb-4">
      {label ? (
        <Text className="mb-2 text-xs font-medium" style={{ color: t.sub }}>
          {label}
        </Text>
      ) : null}
      <View className="flex-row flex-wrap gap-3" accessibilityRole="radiogroup">
        {palette.map((c) => {
          // Reanimated's Babel check treats every `object.value` used inside
          // an inline style as a SharedValue, even though this is a plain
          // colour preset. Alias it before the style so development builds
          // do not emit one false warning for every swatch.
          const hex = c.value;
          const selected =
            (value ?? "").toLowerCase() === hex.toLowerCase();
          return (
            <Pressable
              key={hex}
              onPress={disabled ? undefined : () => onChange(hex)}
              disabled={disabled}
              hitSlop={4}
              accessibilityRole="radio"
              accessibilityLabel={`Цвет ${c.name}`}
              accessibilityState={{ selected, disabled: !!disabled }}
              className="h-9 w-9 items-center justify-center rounded-full"
              style={{
                backgroundColor: hex,
                borderWidth: selected ? 2 : 0,
                borderColor: t.ink,
              }}
            />
          );
        })}
      </View>
    </View>
  );
}
