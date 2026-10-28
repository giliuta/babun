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
import { SocialButtons } from "@/components/auth/SocialButtons";
import { getPendingInvitationToken } from "@/features/settings/pending-invitation";
import { CAN_SIGN_UP_HERE } from "@/lib/pay-here";
import { emailLinkOtpType, parseRecoveryLink } from "@/lib/recovery-link";
import { supabase } from "@/lib/supabase";

// ВХОД — «ВОЙТИ», РЕГИСТРАЦИЯ — ОТДЕЛЬНЫМ ЭЛЕМЕНТОМ. Единая страница, где
// «Продолжить» молча заводит аккаунт, если пароль не подошёл, путает:
// человек не понимает, вошёл он или регистрируется, а ошибка в пароле
// к своему аккаунту превращается в «придумайте другой пароль».
// Поэтому «Войти» только входит (почта не подтверждена — экран кода), а
// «Зарегистрироваться» ведёт на «Создать аккаунт» (`register.tsx`: имя,
// почта, пароль). Сверху — «Продолжить с Apple / Google» (`SocialButtons`).
// Кнопка регистрации есть там, где аккаунт можно завести (`CAN_SIGN_UP_HERE`)
// или ждёт приглашение.
// КНОПКА ИЗ ПИСЬМА ПОДТВЕРЖДЕНИЯ. Два вида ссылки:
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
  // Регистрация: можно везде, где можно (`CAN_SIGN_UP_HERE`), и по приглашению.
  const [canRegister, setCanRegister] = useState(CAN_SIGN_UP_HERE);
  useEffect(() => {
    if (CAN_SIGN_UP_HERE) return;
    void getPendingInvitationToken()
      .catch(() => null)
      .then((token) => setCanRegister(Boolean(token)));
  }, []);

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
    // ПОЧТА НЕ ПОДТВЕРЖДЕНА — СРАЗУ ЭКРАН КОДА, а не ошибка:
    // зарегистрировался, закрыл приложение, не ввёл код — вводит его здесь.
    if (e && (e.code === "email_not_confirmed" || /not confirmed/i.test(e.message))) {
      setLoading(false);
      setUnconfirmed(true);
      return;
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
        // «Войти» письма не шлёт: без этого карточка писала «Отправили письмо»
        // и на минуту гасила «Отправить ещё раз», хотя письма не было.
        sentAlready={false}
        onChangeEmail={() => setUnconfirmed(false)}
        onBackToLogin={() => setUnconfirmed(false)}
      />
    );
  }

  return (
    <AuthCard
      // РЕГИСТРАЦИЯ — ТИХОЙ СТРОКОЙ ВНИЗУ, а не большой кнопкой.
      footer={
        canRegister ? (
          <SwitchLink lead="Нет аккаунта?" action="Регистрация" onPress={() => router.push("/register")} />
        ) : null
      }
    >
      <SocialButtons onError={setError} disabled={loading} />
      <InputCard>
        <AuthField
          value={email}
          onChangeText={edit(setEmail)}
          placeholder="Почта"
          accessibilityLabel="Почта"
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
        label={loading ? "Входим…" : "Войти"}
        onPress={signIn}
        disabled={!valid}
        loading={loading}
      />

      <GhostLink label="Забыли пароль?" onPress={() => router.push("/forgot-password")} />

    </AuthCard>
  );
}
