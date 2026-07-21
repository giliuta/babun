import { type ReactNode } from "react";
import {
  Pressable,
  Text,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { useThemeColors } from "@/theme/colors";
import { haptics } from "@/lib/haptics";
import { readableColorOnTint, readableTextOnColor } from "./color-contrast";

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
  checkbox,
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
  /** Announce as a checkbox (multi-choice groups) — VoiceOver «отмечено». */
  checkbox?: boolean;
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
      fg = readableTextOnColor(hue, t.ink, t.onAccent);
      border = hue;
    } else {
      bg = t.surface;
      fg = color ? readableColorOnTint(hue, t.surface, t.ink, 0) : t.ink;
      border = color ? hue : t.separator;
    }
  } else if (variant === "tint") {
    if (selected) {
      bg = `${hue}14`;
      fg = readableColorOnTint(hue, t.surface, t.ink, 0x14 / 255);
      border = hue;
    } else {
      bg = t.fill;
      fg = t.sub;
    }
  } else {
    if (selected) {
      bg = hue;
      fg = readableTextOnColor(hue, t.ink, t.onAccent);
    } else if (idleColor) {
      bg = `${idleColor}24`;
      fg = readableColorOnTint(idleColor, t.surface, t.ink, 0x24 / 255);
    } else {
      bg = t.fill;
      fg = t.sub;
    }
  }

  // Лёгкий «тик» выбора на каждый тап пилюли — единый премиальный отклик
  // для всех чипов приложения (no-op до нативного ребилда expo-haptics).
  const press =
    disabled || !onPress
      ? undefined
      : () => {
          haptics.tap();
          onPress();
        };

  return (
    <Pressable
      onPress={press}
      disabled={disabled || !onPress}
      hitSlop={onPress ? { top: 6, bottom: 6 } : undefined}
      accessible={!!onPress}
      accessibilityRole={
        onPress
          ? radio
            ? "radio"
            : checkbox
              ? "checkbox"
              : "button"
          : undefined
      }
      accessibilityState={
        onPress
          ? checkbox
            ? { checked: selected, disabled: !!disabled }
            : { selected, disabled: !!disabled }
          : undefined
      }
      accessibilityLabel={
        accessibilityLabel ??
        (count !== undefined ? `${label}, ${count}` : label)
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
        maxFontSizeMultiplier={1.3}
        adjustsFontSizeToFit
        minimumFontScale={0.75}
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
          maxFontSizeMultiplier={1.3}
          numberOfLines={1}
          style={{
            fontSize: 13,
            fontWeight: "600",
            color: fg,
            fontVariant: ["tabular-nums"],
          }}
        >
          {count}
        </Text>
      ) : null}
    </Pressable>
  );
}
