import { useEffect, useState } from "react";
import { Text } from "react-native";
import { useRouter } from "expo-router";
import * as Linking from "expo-linking";
import {
  AuthCard,
  FormError,
  GhostLink,
  InputCard,
  NoticeCard,
  PasswordInput,
  PillButton,
} from "@/components/auth/AuthCard";
import { mapAuthError } from "@/components/auth/authErrors";
import { useAuthTheme } from "@/components/auth/theme";
import { supabase } from "@/lib/supabase";

// Set-new-password screen — the exit of the reset flow. The recovery deep link
// (babun://reset-password#access_token=…) establishes a recovery session here;
// the RootNavigator keeps us on this screen (see app/_layout.tsx) so the user
// can set a new password instead of bouncing to the dashboard.
export default function ResetPasswordScreen() {
  const router = useRouter();
  const t = useAuthTheme();
  const url = Linking.useURL();
  const [ready, setReady] = useState(false);
  const [expired, setExpired] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let active = true;
    async function hydrate() {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session) {
        if (active) setReady(true);
        return;
      }
      const link = url ?? (await Linking.getInitialURL());
      if (!link) return;
      const qp = Linking.parse(link).queryParams ?? {};
      const frag = link.includes("#")
        ? Object.fromEntries(new URLSearchParams(link.split("#")[1]))
        : {};
      const access_token = (qp.access_token as string) ?? frag.access_token;
      const refresh_token = (qp.refresh_token as string) ?? frag.refresh_token;
      const token_hash = (qp.token_hash as string) ?? frag.token_hash;
      if (access_token && refresh_token) {
        const { error: e } = await supabase.auth.setSession({ access_token, refresh_token });
        if (active) (e ? setExpired(true) : setReady(true));
      } else if (token_hash) {
        const { error: e } = await supabase.auth.verifyOtp({ type: "recovery", token_hash });
        if (active) (e ? setExpired(true) : setReady(true));
      } else if (active) {
        setExpired(true);
      }
    }
    void hydrate();
    return () => {
      active = false;
    };
  }, [url]);

  async function update() {
    if (password.length < 8 || loading) return;
    setLoading(true);
    setError(null);
    const { error: e } = await supabase.auth.updateUser({ password });
    if (e) {
      setLoading(false);
      setError(mapAuthError(e, "reset"));
      return;
    }
    // End the recovery session: the done-screen promises «Теперь можно
    // войти», and with a live session the root guard would bounce «Войти»
    // straight into the app instead of showing /login.
    await supabase.auth.signOut();
    setLoading(false);
    setDone(true);
  }

  if (done) {
    return (
      <AuthCard title="Пароль обновлён" subtitle="Теперь можно войти">
        <NoticeCard>Новый пароль сохранён. Войдите с ним в Babun.</NoticeCard>
        <PillButton label="Войти" onPress={() => router.replace("/login")} />
      </AuthCard>
    );
  }

  if (expired) {
    return (
      <AuthCard title="Ссылка истекла" subtitle="Запросите новую">
        <NoticeCard>
          Ссылка для сброса пароля недействительна или уже использована.
        </NoticeCard>
        <PillButton label="Запросить заново" onPress={() => router.replace("/forgot-password")} />
        <GhostLink label="Вернуться ко входу" muted onPress={() => router.replace("/login")} />
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Новый пароль" subtitle="Придумайте пароль для входа">
      <InputCard>
        <PasswordInput
          value={password}
          onChangeText={(v) => {
            setPassword(v);
            if (error) setError(null);
          }}
          placeholder="Новый пароль"
          accessibilityLabel="Новый пароль"
          autoComplete="new-password"
          textContentType="newPassword"
          autoFocus
          returnKeyType="go"
          onSubmitEditing={update}
        />
      </InputCard>

      {password.length > 0 && password.length < 8 ? (
        <Text style={{ marginTop: 8, marginLeft: 4, fontSize: 13, color: t.sub }}>
          Минимум 8 символов
        </Text>
      ) : null}

      <FormError message={error} />

      <PillButton
        label={loading ? "Сохраняем…" : "Сохранить пароль"}
        onPress={update}
        disabled={password.length < 8 || !ready}
        loading={loading}
      />

      <GhostLink label="Вернуться ко входу" muted onPress={() => router.replace("/login")} />
    </AuthCard>
  );
}
