import { Pressable, Text } from "react-native";
import { GradientButton } from "./GradientButton";
import { useThemeColors } from "@/theme/colors";
import { Spinner } from "@/components/ui/Spinner";

type Variant = "primary" | "secondary";
type Tone = "default" | "danger";

// App-wide button — «Halo Cobalt» (apps/mobile/docs/DESIGN-SYSTEM.md).
// primary → cobalt gradient pill (halo sheen + press dip).
// secondary → clean outline pill on surface; tone="danger" tints the label
// (e.g. «Выйти») without shouting.
export function Button({
  label,
  onPress,
  disabled,
  loading,
  variant = "primary",
  tone = "default",
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: Variant;
  tone?: Tone;
  /** VoiceOver-подсказка, когда label — одно слово и без контекста не
   *  ясно, что случится по нажатию. */
  accessibilityHint?: string;
}) {
  const t = useThemeColors();

  if (variant === "primary") {
    return (
      <GradientButton
        label={label}
        onPress={onPress}
        disabled={disabled}
        loading={loading}
        accessibilityHint={accessibilityHint}
      />
    );
  }

  const isDisabled = disabled || loading;
  const tint = tone === "danger" ? t.danger : t.ink;
  return (
    <Pressable
      onPress={isDisabled ? undefined : onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isDisabled, busy: !!loading }}
      style={({ pressed }) => ({
        // minHeight + padding so Dynamic Type can grow the label (see
        // GradientButton / PillButton — same recipe).
        minHeight: 52,
        paddingVertical: 14,
        borderRadius: t.radius.pill,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
        borderColor: t.separator,
        backgroundColor: t.surface,
        opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1,
      })}
    >
      {loading ? (
        <Spinner size={18} color={tone === "danger" ? t.danger : t.accent} label="Сохраняем" />
      ) : (
        <Text
          maxFontSizeMultiplier={1.3}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.75}
          style={{ fontSize: 17, fontWeight: "600", color: tint }}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}
