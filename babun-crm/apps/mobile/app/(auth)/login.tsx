import { useRef, useState } from "react";
import { TextInput } from "react-native";
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
import { supabase } from "@/lib/supabase";

// «Вход в Babun» — email/password right on the screen (fewest taps),
// Registration and password recovery stay available; unfinished OAuth is hidden.
export default function LoginScreen() {
  const router = useRouter();
  const passwordRef = useRef<TextInput>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
    if (e) setError(mapAuthError(e, "signin"));
    // success → SessionProvider redirects
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
      <SwitchLink
        lead="Нет аккаунта?"
        action="Зарегистрироваться"
        onPress={() => router.push("/register")}
      />
    </AuthCard>
  );
}
