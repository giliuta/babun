import { useEffect, useRef, useState } from "react";
import { Alert, Linking, Text, TextInput } from "react-native";
import { useRouter } from "expo-router";
import {
  AuthCard,
  AuthField,
  FormError,
  GhostLink,
  InputCard,
  InputDivider,
  NoticeCard,
  PasswordInput,
  PillButton,
  SwitchLink,
} from "@/components/auth/AuthCard";
import { OrDivider, SocialButtons } from "@/components/auth/SocialAuthButtons";
import { mapAuthError } from "@/components/auth/authErrors";
import { useAuthTheme } from "@/components/auth/theme";
import { supabase } from "@/lib/supabase";

// «Создать аккаунт» — minimal sign-up: brand, Apple + Google, then name/email/
// password inline (chained return key). Terms is a one-line legal note. The
// «Проверьте почту» state is an actionable hub (resend / open mail / fix email).
export default function RegisterScreen() {
  const router = useRouter();
  const t = useAuthTheme();
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((c) => (c > 0 ? c - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const valid =
    fullName.trim().length > 0 &&
    email.trim().length > 0 &&
    password.length >= 8;

  function edit(set: (v: string) => void) {
    return (v: string) => {
      set(v);
      if (error) setError(null);
    };
  }

  async function submit() {
    if (!valid || loading) return;
    setLoading(true);
    setError(null);
    const { data, error: e } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name: fullName.trim() } },
    });
    if (e) {
      setError(mapAuthError(e, "signup"));
      setLoading(false);
      return;
    }
    if (!data.session) {
      setPending(true);
      setCooldown(45);
      setLoading(false);
    }
  }

  async function resend() {
    if (cooldown > 0) return;
    const { error: e } = await supabase.auth.resend({
      type: "signup",
      email: email.trim(),
    });
    if (e) {
      // Rate limit / network — don't restart the cooldown and don't let the
      // user believe the email went out.
      setError(mapAuthError(e, "signup"));
      return;
    }
    setError(null);
    setCooldown(45);
  }

  const openMail = () => Linking.openURL("message://").catch(() => undefined);

  const soon = (name: string) =>
    Alert.alert(
      name,
      `Регистрация через ${name} подключаем в следующей сборке. Пока создайте аккаунт по почте.`,
    );

  if (pending) {
    return (
      <AuthCard title="Проверьте почту" subtitle="Подтвердите адрес, чтобы войти">
        <NoticeCard>
          Письмо со ссылкой ушло на{" "}
          <Text style={{ fontWeight: "600", color: t.ink }}>{email.trim()}</Text>.
          Откройте его, перейдите по ссылке — и возвращайтесь, чтобы войти.
        </NoticeCard>
        <FormError message={error} />
        <PillButton label="Открыть Почту" onPress={openMail} />
        <GhostLink
          label={cooldown > 0 ? `Отправить снова (${cooldown})` : "Отправить ещё раз"}
          muted={cooldown > 0}
          onPress={resend}
        />
        <GhostLink label="Изменить email" muted onPress={() => setPending(false)} />
        <GhostLink label="Вернуться ко входу" muted onPress={() => router.replace("/login")} />
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Создать аккаунт">
      <SocialButtons onApple={() => soon("Apple")} onGoogle={() => soon("Google")} />

      <OrDivider />

      <InputCard>
        <AuthField
          value={fullName}
          onChangeText={edit(setFullName)}
          placeholder="Ваше имя"
          accessibilityLabel="Ваше имя"
          autoComplete="name"
          textContentType="name"
          maxLength={120}
          returnKeyType="next"
          blurOnSubmit={false}
          onSubmitEditing={() => emailRef.current?.focus()}
        />
        <InputDivider />
        <AuthField
          ref={emailRef}
          value={email}
          onChangeText={edit(setEmail)}
          placeholder="Email"
          accessibilityLabel="Email"
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          inputMode="email"
          textContentType="username"
          returnKeyType="next"
          blurOnSubmit={false}
          onSubmitEditing={() => passwordRef.current?.focus()}
        />
        <InputDivider />
        <PasswordInput
          ref={passwordRef}
          value={password}
          onChangeText={edit(setPassword)}
          placeholder="Пароль"
          accessibilityLabel="Пароль"
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="go"
          onSubmitEditing={submit}
        />
      </InputCard>

      {password.length > 0 && password.length < 8 ? (
        <Text style={{ marginTop: 8, marginLeft: 4, fontSize: 13, color: t.sub }}>
          Минимум 8 символов
        </Text>
      ) : null}

      <FormError message={error} />

      <PillButton
        label={loading ? "Создаём…" : "Создать аккаунт"}
        onPress={submit}
        disabled={!valid}
        loading={loading}
      />

      <SwitchLink lead="Уже есть аккаунт?" action="Войти" onPress={() => router.replace("/login")} />

      <Text
        style={{
          marginTop: 16,
          textAlign: "center",
          fontSize: 12,
          lineHeight: 17,
          color: t.sub,
        }}
      >
        Создавая аккаунт, вы принимаете{" "}
        <Text style={{ color: t.accent }} onPress={() => Linking.openURL("https://babun.app/terms")}>
          Условия
        </Text>{" "}
        и{" "}
        <Text style={{ color: t.accent }} onPress={() => Linking.openURL("https://babun.app/privacy")}>
          Конфиденциальность
        </Text>
      </Text>
    </AuthCard>
  );
}
