import { ActivityIndicator, Pressable, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { useAuthTheme } from "@/components/auth/theme";

// «Вход в Babun» social stack — apps/mobile/docs/DESIGN-SYSTEM.md + the SaaS
// login research spec. Three full-width 52pt pill buttons, equal weight,
// vertical: Apple → Google → email. App Store 4.8 requires Sign in with Apple
// when Google is offered, at equal prominence — the uniform stack satisfies it.
//
// Apple is an INTERIM custom button here; it MUST be swapped for the native
// expo-apple-authentication <AppleAuthenticationButton/> at the next native
// rebuild (Phase B) for brand compliance. Google is a compliant custom build
// (Google Light spec: #fff fill, #747775 stroke, full-color G, #1F1F1F text).

function AppleLogo({ color = "#fff" }: { color?: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24">
      <Path
        fill={color}
        d="M17.543 12.718c-.022-2.49 2.034-3.683 2.127-3.74-1.16-1.697-2.962-1.93-3.6-1.956-1.532-.155-2.99.903-3.766.903-.776 0-1.974-.88-3.247-.856-1.67.025-3.21.971-4.07 2.466-1.736 3.01-.444 7.466 1.245 9.91.826 1.197 1.81 2.54 3.1 2.493 1.243-.05 1.712-.806 3.214-.806 1.502 0 1.924.806 3.24.78 1.337-.025 2.183-1.22 3-2.42.943-1.39 1.332-2.734 1.354-2.803-.03-.013-2.597-.998-2.62-3.96zM15.06 5.42c.686-.83 1.15-1.985 1.023-3.135-.99.04-2.19.66-2.9 1.49-.636.736-1.193 1.91-1.043 3.037 1.105.086 2.234-.562 2.92-1.392z"
      />
    </Svg>
  );
}

function GoogleLogo() {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24">
      <Path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z" />
      <Path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.96-2.91l-3.86-3c-1.08.72-2.45 1.16-4.1 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.29 21.3 7.31 24 12 24z" />
      <Path fill="#FBBC05" d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z" />
      <Path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.29 2.7 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z" />
    </Svg>
  );
}

function StackButton({
  bg,
  border,
  textColor,
  icon,
  label,
  onPress,
  busy,
  disabled,
}: {
  bg: string;
  border?: string;
  textColor: string;
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
}) {
  const off = disabled || busy;
  return (
    <Pressable
      onPress={off ? undefined : onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, busy: !!busy }}
      style={({ pressed }) => ({
        height: 52,
        borderRadius: 999,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        marginBottom: 10,
        backgroundColor: bg,
        borderWidth: border ? 1 : 0,
        borderColor: border,
        boxShadow: "0px 1px 2px rgba(11,18,32,0.04)",
        opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
      })}
    >
      {busy ? <ActivityIndicator color={textColor} /> : icon}
      <Text style={{ fontSize: 16, fontWeight: "600", color: textColor }}>{label}</Text>
    </Pressable>
  );
}

// Apple + Google buttons — equal size/weight, with a busy/disabled contract for
// when native OAuth lands. Email/password is inline on the screen below.
export function SocialButtons({
  onApple,
  onGoogle,
  loading = null,
  disabled = false,
}: {
  onApple: () => void;
  onGoogle: () => void;
  loading?: "apple" | "google" | null;
  disabled?: boolean;
}) {
  const t = useAuthTheme();
  // Apple HIG on the app's fixed light surface: black button, white content.
  const appleBg = "#000000";
  const appleFg = "#ffffff";
  return (
    <View>
      <StackButton
        bg={appleBg}
        textColor={appleFg}
        icon={<AppleLogo color={appleFg} />}
        label="Продолжить с Apple"
        onPress={onApple}
        busy={loading === "apple"}
        disabled={disabled}
      />
      <StackButton
        bg={t.googleBg}
        border={t.googleBorder}
        textColor={t.googleText}
        icon={<GoogleLogo />}
        label="Продолжить с Google"
        onPress={onGoogle}
        busy={loading === "google"}
        disabled={disabled}
      />
    </View>
  );
}

// «———— или ————» between the social buttons and the email/password fields.
export function OrDivider() {
  const t = useAuthTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginVertical: 16 }}>
      <View style={{ flex: 1, height: 1, backgroundColor: t.separator }} />
      <Text style={{ fontSize: 12, fontWeight: "600", color: t.sub }}>или</Text>
      <View style={{ flex: 1, height: 1, backgroundColor: t.separator }} />
    </View>
  );
}
