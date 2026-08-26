import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useThemeColors } from "@/theme/colors";
import { ctaGradient } from "@/components/ui/color-contrast";
import { useReduceMotion } from "@/lib/reduce-motion";
import { Spinner } from "@/components/ui/Spinner";

// The «Halo Cobalt» primary action — full-width cobalt-gradient pill with a
// floating accent shadow, a slow halo sheen sweep, and a press dip. The ONLY
// Gradient surface in the app besides the logo. All motion is gated on Reduce
// Motion. apps/mobile/docs/DESIGN-SYSTEM.md.
//
// `tint` dresses this ONE gradient in the appointment's identity colour on the
// booking screen (still the app's only gradient). Endpoints, label and shadow
// are AA-derived from the hex; undefined = today's cobalt, byte-identical.
const FILL = { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 } as const;

export function GradientButton({
  label,
  onPress,
  disabled,
  loading,
  sheen = true,
  tint,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  sheen?: boolean;
  tint?: string;
  /** VoiceOver-подсказка, когда label — одно слово («Клиент») и без
   *  контекста не ясно, что случится по нажатию. */
  accessibilityHint?: string;
}) {
  const t = useThemeColors();
  const reduced = useReduceMotion();
  const filled = loading || !disabled;
  const pressable = !disabled && !loading;
  const g = tint ? ctaGradient(tint) : null;
  const fromColor = g?.from ?? t.accentFrom;
  const toColor = g?.to ?? t.accentTo;
  const labelColor = g?.label ?? t.onAccent;
  // Pale tints carry an ink label; the white sheen/edge would read dirty over
  // a near-white fill, so gate the glass overlays off for them.
  const glassEdge = g ? g.sheen : true;
  const animate = sheen && glassEdge && !reduced;
  const [w, setW] = useState(0);
  const scale = useSharedValue(1);
  const sweep = useSharedValue(-160);

  useEffect(() => {
    if (filled && animate && w > 0) {
      // Two sweeps, then rest — an endless loop kept the UI thread redrawing
      // (GPU/battery) the whole time a sheet with a primary CTA was open.
      sweep.value = -160;
      sweep.value = withRepeat(
        withTiming(w + 60, { duration: 2600, easing: Easing.inOut(Easing.quad) }),
        2,
        false,
      );
    }
    return () => cancelAnimation(sweep);
  }, [filled, animate, w, sweep]);

  const scaleStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const sweepStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: sweep.value }, { skewX: "-18deg" }],
  }));

  return (
    <Pressable
      onPress={pressable ? onPress : undefined}
      onPressIn={() => {
        if (pressable && !reduced) scale.value = withTiming(0.97, { duration: 120 });
      }}
      onPressOut={() => {
        if (!reduced) scale.value = withSpring(1, { damping: 16 });
      }}
      disabled={!pressable}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !pressable, busy: !!loading }}
    >
      <Animated.View
        onLayout={(e) => setW(e.nativeEvent.layout.width)}
        style={[
          {
            // minHeight + padding (not a fixed height) so Dynamic Type can
            // grow the label without clipping — same recipe as PillButton.
            // 52, not 50: §5 fixes the primary CTA at 52pt, and the 2pt debt
            // made the loudest button in the product SHORTER than the
            // secondary pills sitting next to it on the same sheet.
            minHeight: 52,
            paddingVertical: 14,
            borderRadius: t.radius.cta,
            borderCurve: "continuous",
            overflow: "hidden",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: filled ? toColor : t.disabledFill,
            boxShadow: filled ? (g?.shadow ?? t.brandShadow) : undefined,
          },
          scaleStyle,
        ]}
      >
        {filled ? (
          <Svg style={FILL} width="100%" height="100%" pointerEvents="none">
            <Defs>
              {/* Диагональ 135° вместо вертикали — объёмнее на длинной
                  пилюле; вершина чуть светлее за счёт хайлайта ниже. */}
              <LinearGradient id="gbtn" x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0" stopColor={fromColor} />
                <Stop offset="1" stopColor={toColor} />
              </LinearGradient>
            </Defs>
            <Rect width="100%" height="100%" fill="url(#gbtn)" />
          </Svg>
        ) : null}
        {filled && glassEdge ? (
          // Внутренний верхний хайлайт — «стеклянная» кромка премиальной
          // кнопки: волосяная светлая линия по верхнему краю пилюли.
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              top: 0,
              left: 12,
              right: 12,
              height: 1,
              borderRadius: 1,
              backgroundColor: "rgba(255,255,255,0.35)",
            }}
          />
        ) : null}
        {filled && animate ? (
          <Animated.View
            pointerEvents="none"
            style={[
              { position: "absolute", top: -8, bottom: -8, width: 56, backgroundColor: "rgba(255,255,255,0.18)" },
              sweepStyle,
            ]}
          />
        ) : null}
        {loading ? (
          <Spinner size={20} color={labelColor} label="Сохраняем" />
        ) : (
          <Text
            maxFontSizeMultiplier={1.3}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.75}
            style={{
              fontSize: 17,
              fontWeight: "600",
              letterSpacing: 0.2,
              color: filled ? labelColor : t.sub,
            }}
          >
            {label}
          </Text>
        )}
      </Animated.View>
    </Pressable>
  );
}
