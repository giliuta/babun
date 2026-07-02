import { forwardRef, useEffect, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Eye, EyeOff } from "lucide-react-native";
import Svg, {
  Defs,
  LinearGradient,
  RadialGradient,
  Rect,
  Stop,
} from "react-native-svg";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useAuthTheme } from "@/components/auth/theme";

// «Halo Cobalt» auth surfaces — one styling dialect, formal «вы», §5 focus ring,
// light + dark token inversion via useAuthTheme(). apps/mobile/docs/DESIGN-SYSTEM.md.
const FILL = { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 } as const;

// The single decorative light source — a soft cobalt bloom from the top.
function AmbientHalo() {
  const t = useAuthTheme();
  return (
    <Svg style={FILL} width="100%" height="100%" pointerEvents="none">
      <Defs>
        <RadialGradient id="halo" cx="50%" cy="6%" r="75%">
          <Stop offset="0" stopColor={t.accentFrom} stopOpacity={t.haloOpacity} />
          <Stop offset="1" stopColor={t.accentFrom} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect width="100%" height="100%" fill={t.canvas} />
      <Rect width="100%" height="100%" fill="url(#halo)" />
    </Svg>
  );
}

// Cobalt gradient tile with a «b» monogram, nudged down onto the optical centre.
export function BrandMark({ size = 64 }: { size?: number }) {
  const t = useAuthTheme();
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel="Babun"
      style={{
        height: size,
        width: size,
        borderRadius: size * 0.28,
        overflow: "hidden",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: t.brandShadow,
      }}
    >
      <Svg width={size} height={size} style={{ position: "absolute" }}>
        <Defs>
          <LinearGradient id="mark" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={t.accentFrom} />
            <Stop offset="1" stopColor={t.accentTo} />
          </LinearGradient>
        </Defs>
        <Rect width={size} height={size} fill="url(#mark)" />
      </Svg>
      <Text
        maxFontSizeMultiplier={1.1}
        style={{ fontSize: size * 0.56, lineHeight: size * 0.62, fontWeight: "800", color: "#fff", marginTop: size * 0.03 }}
      >
        b
      </Text>
    </View>
  );
}

// Centered auth layout: ambient halo, brand block, optional title/subtitle,
// the form children. One restrained entrance (gated on Reduce Motion).
export function AuthCard({
  title,
  subtitle,
  children,
}: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const t = useAuthTheme();
  const reduced = useReducedMotion();
  const enter = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) {
      enter.value = 1;
      return;
    }
    enter.value = withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) });
  }, [enter, reduced]);
  const colStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * 12 }],
  }));

  return (
    <View style={{ flex: 1, backgroundColor: t.canvas }}>
      <StatusBar style={t.statusBar} />
      <AmbientHalo />
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView
            contentContainerStyle={{
              flexGrow: 1,
              justifyContent: "center",
              paddingHorizontal: 28,
              paddingTop: 24,
              paddingBottom: 28,
            }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            contentInsetAdjustmentBehavior="automatic"
          >
            <Animated.View style={[{ width: "100%", maxWidth: 360, alignSelf: "center" }, colStyle]}>
              <View className="items-center">
                <BrandMark />
                <Text
                  maxFontSizeMultiplier={1.2}
                  style={{ marginTop: 16, fontSize: 34, lineHeight: 40, fontWeight: "800", letterSpacing: -0.6, color: t.ink }}
                >
                  Babun
                </Text>
                {title ? (
                  <Text
                    maxFontSizeMultiplier={1.2}
                    style={{ marginTop: 20, fontSize: 26, lineHeight: 32, fontWeight: "700", letterSpacing: -0.4, color: t.ink, textAlign: "center" }}
                  >
                    {title}
                  </Text>
                ) : null}
                {subtitle ? (
                  <Text
                    maxFontSizeMultiplier={1.4}
                    style={{ marginTop: 6, fontSize: 15, color: t.sub, textAlign: "center" }}
                  >
                    {subtitle}
                  </Text>
                ) : null}
              </View>
              <View style={{ marginTop: 26 }}>{children}</View>
            </Animated.View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

// Grouped surface card: soft elevation (light) + frosted top-edge highlight.
export function InputCard({ children }: { children: ReactNode }) {
  const t = useAuthTheme();
  return (
    <View
      style={{
        borderRadius: 20,
        backgroundColor: t.surface,
        overflow: "hidden",
        boxShadow: t.cardShadow,
        borderWidth: t.dark ? 1 : 0,
        borderColor: t.separator,
      }}
    >
      <View style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1, backgroundColor: t.highlight }} />
      {children}
    </View>
  );
}

export function InputDivider() {
  const t = useAuthTheme();
  return <View style={{ marginLeft: 16, height: 1, backgroundColor: t.separator }} />;
}

// Grouped-card text row with the §5 focused 1.5px accent inset ring (180ms) and
// an optional trailing accessory. minHeight grows at large Dynamic Type sizes.
export const AuthField = forwardRef<
  TextInput,
  TextInputProps & { trailing?: ReactNode }
>(function AuthField({ trailing, onFocus, onBlur, style, ...props }, ref) {
  const t = useAuthTheme();
  const focus = useSharedValue(0);
  const ringStyle = useAnimatedStyle(() => ({ opacity: focus.value }));
  return (
    <View style={{ minHeight: 52, flexDirection: "row", alignItems: "center" }}>
      <TextInput
        ref={ref}
        placeholderTextColor={t.placeholder}
        selectionColor={t.accent}
        keyboardAppearance={t.dark ? "dark" : "light"}
        onFocus={(e) => {
          focus.value = withTiming(1, { duration: 180 });
          onFocus?.(e);
        }}
        onBlur={(e) => {
          focus.value = withTiming(0, { duration: 180 });
          onBlur?.(e);
        }}
        style={[
          { flex: 1, minHeight: 52, paddingLeft: 16, paddingRight: trailing ? 4 : 16, paddingVertical: 14, fontSize: 15, color: t.ink },
          style,
        ]}
        {...props}
      />
      {trailing}
      <Animated.View
        pointerEvents="none"
        style={[
          { position: "absolute", top: 3, bottom: 3, left: 3, right: 3, borderRadius: 12, borderWidth: 1.5, borderColor: t.accent },
          ringStyle,
        ]}
      />
    </View>
  );
});

// Password row: AuthField + a show/hide eye toggle (44pt target, a11y).
export const PasswordInput = forwardRef<TextInput, TextInputProps>(
  function PasswordInput(props, ref) {
    const t = useAuthTheme();
    const [show, setShow] = useState(false);
    return (
      <AuthField
        ref={ref}
        autoComplete="current-password"
        textContentType="password"
        {...props}
        secureTextEntry={!show}
        trailing={
          <Pressable
            onPress={() => setShow((v) => !v)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={show ? "Скрыть пароль" : "Показать пароль"}
            style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
          >
            {show ? <EyeOff color={t.sub} size={20} /> : <Eye color={t.sub} size={20} />}
          </Pressable>
        }
      />
    );
  },
);

// Shared assertive error line.
export function FormError({ message }: { message?: string | null }) {
  const t = useAuthTheme();
  if (!message) return null;
  return (
    <Text
      accessibilityLiveRegion="assertive"
      style={{ marginTop: 12, paddingHorizontal: 8, textAlign: "center", fontSize: 13, color: t.danger }}
    >
      {message}
    </Text>
  );
}

// Confirmation/notice card (e.g. «Проверьте почту»). Bold inline value via INK.
export function NoticeCard({ children }: { children: ReactNode }) {
  const t = useAuthTheme();
  return (
    <InputCard>
      <Text style={{ paddingHorizontal: 20, paddingVertical: 20, fontSize: 14, lineHeight: 21, color: t.sub }}>
        {children}
      </Text>
    </InputCard>
  );
}

// Full-width accent pill CTA — gradient fill, floating shadow, halo sheen, press
// dip. Motion gated on Reduce Motion. Disabled → legible flat fill.
export function PillButton({
  label,
  onPress,
  disabled,
  loading,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  const t = useAuthTheme();
  const reduced = useReducedMotion();
  const filled = loading || !disabled;
  const pressable = !disabled && !loading;
  const [w, setW] = useState(0);
  const scale = useSharedValue(1);
  const sheen = useSharedValue(-160);

  useEffect(() => {
    if (filled && !reduced && w > 0) {
      // Two sweeps, then rest — an endless loop kept the login screen's UI
      // thread redrawing (GPU/battery) for as long as it was mounted.
      sheen.value = -160;
      sheen.value = withRepeat(
        withTiming(w + 60, { duration: 2600, easing: Easing.inOut(Easing.quad) }),
        2,
        false,
      );
    }
    return () => cancelAnimation(sheen);
  }, [filled, reduced, w, sheen]);

  const scaleStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const sheenStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: sheen.value }, { skewX: "-18deg" }],
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
      accessibilityState={{ disabled: !pressable, busy: !!loading }}
    >
      <Animated.View
        onLayout={(e) => setW(e.nativeEvent.layout.width)}
        style={[
          {
            marginTop: 16,
            minHeight: 52,
            paddingVertical: 14,
            borderRadius: 999,
            overflow: "hidden",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: filled ? t.accentTo : t.disabledFill,
            boxShadow: filled ? t.brandShadow : undefined,
          },
          scaleStyle,
        ]}
      >
        {filled ? (
          <Svg style={FILL} width="100%" height="100%" pointerEvents="none">
            <Defs>
              <LinearGradient id="cta" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={t.accentFrom} />
                <Stop offset="1" stopColor={t.accentTo} />
              </LinearGradient>
            </Defs>
            <Rect width="100%" height="100%" fill="url(#cta)" />
          </Svg>
        ) : null}
        {filled && !reduced ? (
          <Animated.View
            pointerEvents="none"
            style={[
              { position: "absolute", top: -8, bottom: -8, width: 56, backgroundColor: "rgba(255,255,255,0.18)" },
              sheenStyle,
            ]}
          />
        ) : null}
        {loading ? (
          <ActivityIndicator color={t.onAccent} />
        ) : (
          <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 17, fontWeight: "600", color: filled ? t.onAccent : t.sub }}>
            {label}
          </Text>
        )}
      </Animated.View>
    </Pressable>
  );
}

// Centered accent ghost link below the CTA.
export function GhostLink({
  label,
  onPress,
  muted,
}: {
  label: string;
  onPress: () => void;
  muted?: boolean;
}) {
  const t = useAuthTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={{ height: 44, alignItems: "center", justifyContent: "center", marginTop: 8 }}
    >
      <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 14, fontWeight: "500", color: muted ? t.sub : t.accent }}>
        {label}
      </Text>
    </Pressable>
  );
}

// «Lead text + accent action» cross-screen switch link.
export function SwitchLink({
  lead,
  action,
  onPress,
}: {
  lead: string;
  action: string;
  onPress: () => void;
}) {
  const t = useAuthTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${lead} ${action}`}
      hitSlop={6}
      style={{ height: 44, alignItems: "center", justifyContent: "center", marginTop: 8 }}
    >
      <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 14, color: t.sub }}>
        {lead} <Text style={{ color: t.accent, fontWeight: "600" }}>{action}</Text>
      </Text>
    </Pressable>
  );
}

