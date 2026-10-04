import { useEffect, useState } from "react";
import { Text } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
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
import { EmailCodeCard } from "@/components/auth/EmailCodeCard";
import { useAuthTheme } from "@/components/auth/theme";
import { signOutScopeAndWipe } from "@/lib/auth-clear";
import { parseRecoveryLink, recoveryLinkKey } from "@/lib/recovery-link";
import { supabase } from "@/lib/supabase";

/** Ссылки восстановления, уже проверенные в этом запуске приложения. */
const verifiedRecoveryLinks = new Set<string>();

// Set-new-password screen — the exit of the reset flow. The recovery deep link
// (babun://reset-password#access_token=…) establishes a recovery session here;
// the RootNavigator keeps us on this screen (see app/_layout.tsx) so the user
// can set a new password instead of bouncing to the dashboard.
export default function ResetPasswordScreen() {
  const router = useRouter();
  const t = useAuthTheme();
  const url = Linking.useURL();
  // Пришли с «Сброс пароля» — почта в адресе, код из письма вводится здесь:
  // сессию восстановления гейт входа держит только на этом экране.
  const { email: emailParam } = useLocalSearchParams<{ email?: string }>();
  const codeEmail = typeof emailParam === "string" ? emailParam.trim() : "";
  const [awaitingCode, setAwaitingCode] = useState(false);
  const [ready, setReady] = useState(false);
  const [expired, setExpired] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [sessionEnded, setSessionEnded] = useState(true);

  useEffect(() => {
    let active = true;
    async function hydrate() {
      try {
        // ЧЕЙ ПАРОЛЬ — РЕШАЕТ ССЫЛКА, А НЕ ТОТ, КТО СЕЙЧАС ВОШЁЛ (аудит 03.10).
        // Раньше при живой сессии ссылка не читалась вовсе: на телефоне вошёл
        // A, открыли письмо сброса аккаунта B — и «Сохранить пароль» менял
        // пароль A, выкидывал его и стирал его данные, а ссылка B оставалась
        // непотраченной. Просроченная ссылка у вошедшего тоже показывала
        // «Новый пароль». Теперь ссылка проверяется всегда; повторно — только
        // та, что уже проверена в этом запуске (одноразовую второй раз сервер
        // не примет, а сессия на телефоне уже её).
        const link = url ?? (await Linking.getInitialURL());
        const credential = parseRecoveryLink(link);
        if (!credential) {
          if (active) {
            if (codeEmail) setAwaitingCode(true);
            else setExpired(true);
          }
          return;
        }
        const key = recoveryLinkKey(credential);
        if (verifiedRecoveryLinks.has(key)) {
          const {
            data: { session },
          } = await supabase.auth.getSession();
          if (active) {
            if (session) setReady(true);
            else setExpired(true);
          }
          return;
        }
        const { error: recoveryError } =
          credential.kind === "session"
            ? await supabase.auth.setSession({
                access_token: credential.accessToken,
                refresh_token: credential.refreshToken,
              })
            : await supabase.auth.verifyOtp({
                type: "recovery",
                token_hash: credential.tokenHash,
              });
        if (!recoveryError) verifiedRecoveryLinks.add(key);
        if (active) {
          if (recoveryError) setExpired(true);
          else setReady(true);
        }
      } catch {
        if (active) setExpired(true);
      }
    }
    void hydrate();
    return () => {
      active = false;
    };
  }, [url, codeEmail]);

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
    let ended = true;
    try {
      await signOutScopeAndWipe("local");
    } catch {
      // The password write already succeeded. Keep that success honest while
      // routing an active recovery session back into the app, not to a login
      // screen that would immediately redirect away.
      ended = false;
    }
    setSessionEnded(ended);
    setLoading(false);
    setDone(true);
  }

  if (done) {
    return (
      <AuthCard
        title="Пароль обновлён"
        subtitle={sessionEnded ? "Теперь можно войти" : "Сеанс остаётся активным"}
      >
        <NoticeCard>
          {sessionEnded
            ? "Новый пароль сохранён. Войдите с ним в Babun."
            : "Новый пароль сохранён. Вы можете продолжить работу в текущем защищённом сеансе."}
        </NoticeCard>
        <PillButton
          label={sessionEnded ? "Войти" : "Продолжить"}
          onPress={() => router.replace(sessionEnded ? "/login" : "/")}
        />
      </AuthCard>
    );
  }

  if (awaitingCode) {
    return (
      <EmailCodeCard
        kind="recovery"
        email={codeEmail}
        onVerified={() => {
          setAwaitingCode(false);
          setReady(true);
        }}
        onChangeEmail={() => router.replace("/forgot-password")}
        onBackToLogin={() => router.replace("/login")}
      />
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

  if (!ready) {
    return (
      <AuthCard title="Новый пароль" subtitle="Проверяем ссылку">
        <NoticeCard>Проверяем защищённую ссылку восстановления…</NoticeCard>
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
