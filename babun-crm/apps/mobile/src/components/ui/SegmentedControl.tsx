import { Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";
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
  style,
}: {
  options: readonly SegmentOption<V>[];
  value: V;
  onChange: (v: V) => void;
  /** Locks the control (e.g. type of an existing operation). */
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useThemeColors();
  return (
    <View
      accessibilityRole="radiogroup"
      style={[
        {
          flexDirection: "row",
          borderRadius: 12,
          padding: 4,
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
            onPress={() => onChange(opt.value)}
            accessibilityRole="radio"
            accessibilityLabel={opt.label}
            accessibilityState={{ selected: active, disabled: !!disabled }}
            style={{
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 10,
              paddingVertical: 8,
              minHeight: 36,
              backgroundColor: active ? t.surface : "transparent",
              opacity: disabled && !active ? 0.4 : 1,
            }}
          >
            <Text
              style={{
                fontSize: 14,
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
