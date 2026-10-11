import { useEffect, useRef, useState } from "react";
import { uiLocale } from "@babun/shared/i18n/locale";
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
} from "@/components/auth/AuthCard";
import { mapAuthError, signUpHitExistingAccount } from "@/components/auth/authErrors";
import { EmailCodeCard, SIGNUP_LINK_REDIRECT } from "@/components/auth/EmailCodeCard";
import { SocialButtons } from "@/components/auth/SocialButtons";
import { getPendingInvitationToken } from "@/features/settings/pending-invitation";
import { CAN_SIGN_UP_HERE } from "@/lib/pay-here";
import { emailLinkOtpType, parseRecoveryLink } from "@/lib/recovery-link";
import { supabase } from "@/lib/supabase";

// ЕДИНАЯ СТРАНИЦА ВХОДА И РЕГИСТРАЦИИ (владелец 09.10: «если регистрация уже
// была на этот адрес — сразу входит в аккаунт, если нет — отправляет на
// регистрацию»; слова «регистрация» на экране нет). Сверху — «Продолжить с
// Apple / Google» (`SocialButtons`), ниже — почта и пароль с «Продолжить»:
//   • пароль подошёл — вход;
//   • почта не подтверждена — экран кода;
//   • не подошёл — пробуем завести аккаунт этим адресом и паролем. Адрес уже
//     занят — GoTrue молча отвечает пустым `identities`, значит неверен
//     пароль; свободен — уходит письмо с кодом, после кода «Почти готово»
//     спросит имя (`finish_pending`).
// На iPhone новый аккаунт без приглашения не заводится (`CAN_SIGN_UP_HERE`,
// App Review 3.1.1): там неподошедший пароль — просто «Неверная почта или
// пароль».
// КНОПКА ИЗ ПИСЬМА ПОДТВЕРЖДЕНИЯ (04.10). Два вида ссылки:
// • #access_token… — сервер Supabase уже подтвердил и вернул вход в адресе;
// • ?token_hash=…&type=email — одноразовый ключ, который тратит только этот
//   экран (verifyOtp). Такую ссылку не «съедает» почтовый сканер, открывающий
//   ссылки заранее, и она ведёт прямо на babun.app — телефон с Babun
//   открывает её в приложении (universal links).
// Без этого новая вкладка показывала пустой вход, хотя почта подтверждена.
function useSessionFromEmailLink() {
  const url = Linking.useURL();
  useEffect(() => {
    const credential = parseRecoveryLink(url);
    if (!credential) return;
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.history.replaceState(null, "", window.location.pathname);
    }
    // Битая, просроченная или уже потраченная ссылка — остаёмся на входе
    // молча: supabase-js бросает на нечитаемом токене, и без catch веб
    // показывал красный экран.
    const attempt =
      credential.kind === "session"
        ? supabase.auth.setSession({
            access_token: credential.accessToken,
            refresh_token: credential.refreshToken,
          })
        : supabase.auth.verifyOtp({
            token_hash: credential.tokenHash,
            type: emailLinkOtpType(url),
          });
    attempt.catch(() => undefined);
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
  // Письмо с кодом уже ушло (регистрация с этого экрана) — карточка не шлёт
  // второе; при входе с неподтверждённой почтой — шлёт сама.
  const [codeSent, setCodeSent] = useState(false);

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
    const address = email.trim();
    const { error: e } = await supabase.auth.signInWithPassword({ email: address, password });
    // ПОЧТА НЕ ПОДТВЕРЖДЕНА — СРАЗУ ЭКРАН КОДА (владелец 04.10), а не ошибка:
    // зарегистрировался, закрыл приложение, не ввёл код — вводит его здесь.
    if (e && (e.code === "email_not_confirmed" || /not confirmed/i.test(e.message))) {
      setLoading(false);
      setCodeSent(false);
      setUnconfirmed(true);
      return;
    }
    if (e && (e.code === "invalid_credentials" || /invalid login credentials/i.test(e.message))) {
      const mayCreate =
        CAN_SIGN_UP_HERE || !!(await getPendingInvitationToken().catch(() => null));
      if (mayCreate) {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: address,
          password,
          options: {
            emailRedirectTo: SIGNUP_LINK_REDIRECT,
            data: { locale: uiLocale(), finish_pending: true },
          },
        });
        setLoading(false);
        if (signUpError) {
          setError(mapAuthError(signUpError, "signup"));
          return;
        }
        // Адрес занят — значит, не подошёл пароль.
        if (signUpHitExistingAccount(data)) {
          setError(mapAuthError(e, "signin"));
          return;
        }
        // Подтверждение почты выключено — сессия уже есть, гейт уведёт.
        if (data.session) return;
        setCodeSent(true);
        setUnconfirmed(true);
        return;
      }
    }
    setLoading(false);
    if (e) setError(mapAuthError(e, "signin"));
    // success → SessionProvider redirects
  }

  if (unconfirmed) {
    return (
      <EmailCodeCard
        kind="signup"
        email={email.trim()}
        password={password}
        sentAlready={codeSent}
        onChangeEmail={() => setUnconfirmed(false)}
        onBackToLogin={() => setUnconfirmed(false)}
      />
    );
  }

  return (
    <AuthCard>
      <SocialButtons onError={setError} disabled={loading} />
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
          autoComplete="password"
          returnKeyType="go"
          onSubmitEditing={signIn}
        />
      </InputCard>

      <FormError message={error} />

      <PillButton
        label={loading ? "Входим…" : "Продолжить"}
        onPress={signIn}
        disabled={!valid}
        loading={loading}
      />

      <GhostLink label="Забыли пароль?" onPress={() => router.push("/forgot-password")} />
    </AuthCard>
  );
}
