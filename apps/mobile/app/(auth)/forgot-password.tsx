import { useEffect, useState } from "react";
import { Alert, Text } from "react-native";
import { useRouter } from "expo-router";
import * as Linking from "expo-linking";
import {
  AuthCard,
  AuthField,
  FormError,
  GhostLink,
  InputCard,
  NoticeCard,
  PillButton,
} from "@/components/auth/AuthCard";
import { useAuthTheme } from "@/components/auth/theme";
import { supabase } from "@/lib/supabase";

// Mirrors the web ForgotPasswordForm: enter email → reset link emailed (with a
// deep link to the in-app set-new-password screen) → actionable «sent» hub.
// Same response whether the email exists or not (anti-enumeration).
export default function ForgotPasswordScreen() {
  const router = useRouter();
  const t = useAuthTheme();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => (c > 0 ? c - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  async function submit() {
    if (loading || email.trim().length === 0) return;
    setLoading(true);
    setError(null);
    const { error: e } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: Linking.createURL("/reset-password"),
    });
    setLoading(false);
    if (e) {
      const m = (e.message ?? "").toLowerCase();
      if (m.includes("rate") || m.includes("too many"))
        setError("Слишком много попыток, подождите минуту");
      else setError("Нет связи. Проверьте интернет и повторите");
      return;
    }
    setSent(true);
    setCooldown(30);
  }

  const openMail = () =>
    Linking.openURL("message://").catch(() => {
      Alert.alert(
        "Почта недоступна",
        "Откройте приложение почты вручную и найдите письмо от Babun.",
      );
    });

  if (sent) {
    return (
      <AuthCard title="Проверьте почту" subtitle="Если такой email есть — мы отправили ссылку">
        <NoticeCard>
          Письмо ушло на{" "}
          <Text style={{ fontWeight: "600", color: t.ink }}>{email.trim()}</Text>.
          Откройте ссылку из письма — перейдёте на страницу нового пароля.
        </NoticeCard>
        <PillButton label="Открыть Почту" onPress={openMail} />
        <GhostLink
          label={
            loading
              ? "Отправляем…"
              : cooldown > 0
                ? `Отправить снова (${cooldown})`
                : "Отправить ещё раз"
          }
          muted={cooldown > 0 || loading}
          disabled={cooldown > 0 || loading}
          onPress={() => void submit()}
        />
        <GhostLink label="Вернуться ко входу" muted onPress={() => router.replace("/login")} />
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Сброс пароля" subtitle="Введите email — пришлём ссылку">
      <InputCard>
        <AuthField
          value={email}
          onChangeText={(v) => {
            setEmail(v);
            if (error) setError(null);
          }}
          placeholder="Email"
          accessibilityLabel="Email"
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          inputMode="email"
          textContentType="username"
          autoFocus
          returnKeyType="go"
          onSubmitEditing={submit}
        />
      </InputCard>

      <FormError message={error} />

      <PillButton
        label={loading ? "Отправляем…" : "Отправить ссылку"}
        onPress={submit}
        disabled={email.trim().length === 0}
        loading={loading}
      />

      <GhostLink label="Вернуться ко входу" muted onPress={() => router.replace("/login")} />
    </AuthCard>
  );
}
