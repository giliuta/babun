import { type ReactNode } from "react";
import {
  Pressable,
  Text,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { useThemeColors } from "@/theme/colors";

// «Halo Cobalt» chip — the ONE pill for every selectable token in the app
// (DS §5): 32pt pill + vertical hitSlop to a 44pt target.
//
// Variants:
//   filled  (default) selected → solid hue fill + onAccent label;
//                     idle → t.fill + sub label (OperationSheet, statuses…)
//   outline           selected → solid hue fill; idle → surface + 1px hue
//                     border (team chips — the hue stays visible when idle)
//   tint              selected → 8–16% hue tint + hue border + hue label;
//                     idle → t.fill (filter toggles, tag pickers)
// Тёмный или светлый текст поверх заливки hue: относительная яркость по
// YIQ — на жёлтой/оранжевой/зелёной бригаде белый onAccent слеп (< 3:1).
function onHue(hex: string, t: { onAccent: string; ink: string }): string {
  const m = /^#?([0-9a-f]{6})/i.exec(hex);
  if (!m) return t.onAccent;
  const n = parseInt(m[1], 16);
  const yiq =
    ((n >> 16) * 299 + (((n >> 8) & 0xff) * 587) + (n & 0xff) * 114) / 1000;
  return yiq > 165 ? t.ink : t.onAccent;
}

export function Chip({
  label,
  selected = false,
  onPress,
  color,
  variant = "filled",
  count,
  icon,
  disabled,
  dimmed,
  idleColor,
  radio,
  accessibilityLabel,
  numberOfLines = 1,
  style,
  textStyle,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  /** Active hue — defaults to accent. Pass t.danger / t.success / team color. */
  color?: string;
  variant?: "filled" | "outline" | "tint";
  /** Trailing count badge (tabular-nums). */
  count?: number;
  /** Leading icon / flag node. */
  icon?: ReactNode;
  disabled?: boolean;
  /** Kept pressable-looking but faded (e.g. zero-count facet). */
  dimmed?: boolean;
  /** Tint the IDLE state in this hue (e.g. «Без ответа» with pending count). */
  idleColor?: string;
  /** Announce as a radio option instead of a button (single-choice groups). */
  radio?: boolean;
  accessibilityLabel?: string;
  numberOfLines?: number;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}) {
  const t = useThemeColors();
  const hue = color ?? t.accent;

  let bg: string;
  let fg: string;
  let border = "transparent";
  if (variant === "outline") {
    if (selected) {
      bg = hue;
      fg = onHue(hue, t);
      border = hue;
    } else {
      bg = t.surface;
      fg = color ? hue : t.ink;
      border = color ? hue : t.separator;
    }
  } else if (variant === "tint") {
    if (selected) {
      bg = hue + (t.dark ? "29" : "14");
      fg = hue;
      border = hue;
    } else {
      bg = t.fill;
      fg = t.sub;
    }
  } else {
    if (selected) {
      bg = hue;
      fg = onHue(hue, t);
    } else if (idleColor) {
      bg = `${idleColor}24`;
      fg = idleColor;
    } else {
      bg = t.fill;
      fg = t.sub;
    }
  }

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      hitSlop={{ top: 6, bottom: 6 }}
      accessibilityRole={radio ? "radio" : "button"}
      accessibilityState={{ selected, disabled: !!disabled }}
      accessibilityLabel={
        accessibilityLabel ?? (count !== undefined ? `${label}, ${count}` : label)
      }
      style={({ pressed }) => [
        {
          minHeight: 32,
          borderRadius: t.radius.pill,
          paddingHorizontal: 14,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          borderWidth: 1,
          borderColor: border,
          backgroundColor: bg,
          opacity: pressed ? 0.7 : dimmed ? 0.4 : 1,
        },
        style,
      ]}
    >
      {icon}
      <Text
        numberOfLines={numberOfLines}
        style={[
          { fontSize: 13, fontWeight: "600", color: fg, flexShrink: 1 },
          textStyle,
        ]}
      >
        {label}
      </Text>
      {count !== undefined ? (
        <Text
          style={{
            fontSize: 13,
            fontWeight: "600",
            color: fg,
            opacity: 0.7,
            fontVariant: ["tabular-nums"],
          }}
        >
          {count}
        </Text>
      ) : null}
    </Pressable>
  );
}
