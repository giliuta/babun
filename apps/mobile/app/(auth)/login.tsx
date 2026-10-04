import { useEffect, useRef, useState } from "react";
import { Platform, TextInput } from "react-native";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import {
  AuthCard,
  AuthField,
  FormError,
  GhostLink,
  InputCard,
  InputDivider,
  PasswordInput,
  PillButton,
  SwitchLink,
} from "@/components/auth/AuthCard";
import { mapAuthError } from "@/components/auth/authErrors";
import { EmailCodeCard } from "@/components/auth/EmailCodeCard";
import { parseRecoveryLink } from "@/lib/recovery-link";
import { supabase } from "@/lib/supabase";

// «Вход в Babun» — email/password right on the screen (fewest taps),
// Registration and password recovery stay available; unfinished OAuth is hidden.
// КНОПКА ИЗ ПИСЬМА ПОДТВЕРЖДЕНИЯ (04.10). Сервер подтверждает почту и
// открывает babun.app/login со входом в адресе (#access_token…). Без этого
// новая вкладка показывала пустой вход, хотя почта уже подтверждена.
function useSessionFromEmailLink() {
  const url = Linking.useURL();
  useEffect(() => {
    const credential = parseRecoveryLink(url);
    if (credential?.kind !== "session") return;
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.history.replaceState(null, "", window.location.pathname);
    }
    // Битая или просроченная ссылка — остаёмся на входе молча: supabase-js
    // бросает на нечитаемом токене, и без catch веб показывал красный экран.
    supabase.auth
      .setSession({
        access_token: credential.accessToken,
        refresh_token: credential.refreshToken,
      })
      .catch(() => undefined);
  }, [url]);
}

export default function LoginScreen() {
  useSessionFromEmailLink();
  const router = useRouter();
  const passwordRef = useRef<TextInput>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState(false);

  const valid = email.trim().length > 0 && password.length > 0;

  function edit(set: (v: string) => void) {
    return (v: string) => {
      set(v);
      if (error) setError(null);
    };
  }

  async function signIn() {
    if (!valid || loading) return;
    setError(null);
    setLoading(true);
    const { error: e } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setLoading(false);
    // ПОЧТА НЕ ПОДТВЕРЖДЕНА — СРАЗУ ЭКРАН КОДА (владелец 04.10), а не ошибка:
    // зарегистрировался, закрыл приложение, не ввёл код — вводит его здесь.
    if (e && (e.code === "email_not_confirmed" || /not confirmed/i.test(e.message))) {
      setUnconfirmed(true);
      return;
    }
    if (e) setError(mapAuthError(e, "signin"));
    // success → SessionProvider redirects
  }

  if (unconfirmed) {
    return (
      <EmailCodeCard
        kind="signup"
        email={email.trim()}
        password={password}
        sentAlready={false}
        onChangeEmail={() => setUnconfirmed(false)}
        onBackToLogin={() => setUnconfirmed(false)}
      />
    );
  }

  return (
    <AuthCard>
      <InputCard>
        <AuthField
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
          autoComplete="current-password"
          returnKeyType="go"
          onSubmitEditing={signIn}
        />
      </InputCard>

      <FormError message={error} />

      <PillButton
        label={loading ? "Входим…" : "Войти"}
        onPress={signIn}
        disabled={!valid}
        loading={loading}
      />

      <GhostLink label="Забыли пароль?" onPress={() => router.push("/forgot-password")} />
      {/* ВХОД БЕЗ ПАРОЛЯ (04.10): код из письма, как при регистрации. */}
      <GhostLink label="Войти по коду из письма" onPress={() => router.push("/code-login")} />
      <SwitchLink
        lead="Нет аккаунта?"
        action="Зарегистрироваться"
        onPress={() => router.push("/register")}
      />
    </AuthCard>
  );
}
