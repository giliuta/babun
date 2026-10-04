import { useEffect, useRef, useState } from "react";
import { AppState, Text, TextInput } from "react-native";
import * as Linking from "expo-linking";
import { AuthCard, FormError, GhostLink, PillButton } from "@/components/auth/AuthCard";
import { CodeInput, EMAIL_CODE_LENGTH } from "@/components/auth/CodeInput";
import { mapAuthError } from "@/components/auth/authErrors";
import { useAuthTheme } from "@/components/auth/theme";
import { supabase } from "@/lib/supabase";

/** Куда ведёт кнопка письма подтверждения. Подтверждает почту сам переход по
 *  ссылке (сервер Supabase), а вход из ссылки берёт экран входа веба Babun
 *  (`useSessionFromEmailLink`). */
export const SIGNUP_LINK_REDIRECT = "https://babun.app/login";

const RESEND_COOLDOWN_S = 45;

// «Введите код» — один экран на код из письма Babun (владелец 04.10: «чтоб
// дальше продолжить, оно должно отправить на почту подтверждение»).
//
// • signup — подтверждение почты после регистрации и при входе в
//   неподтверждённый аккаунт. Верный код создаёт сессию, и гейт входа сам
//   уводит в календарь. Кнопка в письме тоже подтверждает: человек
//   возвращается в приложение, и экран входит паролем, который он только что
//   набрал (`password`), — код вводить уже не нужно.
// • recovery — «Забыли пароль»: верный код открывает сессию восстановления,
//   дальше экран нового пароля (`onVerified`).
export function EmailCodeCard({
  kind,
  email,
  password,
  sentAlready = true,
  onVerified,
  onChangeEmail,
  onBackToLogin,
}: {
  kind: "signup" | "recovery";
  email: string;
  /** Пароль, набранный на этом устройстве, — для входа после кнопки в письме. */
  password?: string;
  /** Письмо уже ушло (регистрация, сброс). Вход в неподтверждённый аккаунт
   *  письма не шлёт — «Отправить код» доступна сразу. */
  sentAlready?: boolean;
  onVerified?: () => void;
  onChangeEmail: () => void;
  onBackToLogin: () => void;
}) {
  const t = useAuthTheme();
  const inputRef = useRef<TextInput>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [sent, setSent] = useState(sentAlready);
  const [cooldown, setCooldown] = useState(sentAlready ? RESEND_COOLDOWN_S : 0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((c) => (c > 0 ? c - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  // ВЕРНУЛСЯ ИЗ ПОЧТЫ ПОСЛЕ КНОПКИ — ВХОДИМ САМИ. Пока почта не подтверждена,
  // вход отвечает «not confirmed», и экран молча ждёт кода дальше.
  useEffect(() => {
    if (kind !== "signup" || !password) return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      void supabase.auth.signInWithPassword({ email, password });
    });
    return () => sub.remove();
  }, [kind, email, password]);

  async function verify(token: string) {
    if (verifying || token.length !== EMAIL_CODE_LENGTH) return;
    setVerifying(true);
    setError(null);
    const { error: e } = await supabase.auth.verifyOtp({
      email,
      token,
      type: kind === "signup" ? "email" : "recovery",
    });
    if (e) {
      setVerifying(false);
      setError(mapAuthError(e, "code"));
      setCode("");
      inputRef.current?.focus();
      return;
    }
    // signup: сессия есть — гейт входа уводит с экрана, спиннер держим до
    // размонтирования. recovery: дальше решает экран нового пароля.
    onVerified?.();
  }

  async function resend() {
    if (cooldown > 0 || resending) return;
    setResending(true);
    setError(null);
    const { error: e } =
      kind === "signup"
        ? await supabase.auth.resend({
            type: "signup",
            email,
            options: { emailRedirectTo: SIGNUP_LINK_REDIRECT },
          })
        : await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: Linking.createURL("/reset-password"),
          });
    setResending(false);
    if (e) {
      // Лимит или сеть — счётчик не перезапускаем и не делаем вид, что письмо ушло.
      setError(mapAuthError(e, "code"));
      return;
    }
    setSent(true);
    setCode("");
    setCooldown(RESEND_COOLDOWN_S);
    inputRef.current?.focus();
  }

  const resendLabel = resending
    ? "Отправляем…"
    : cooldown > 0
      ? `Отправить ещё раз (${cooldown})`
      : sent
        ? "Отправить ещё раз"
        : "Отправить код";

  return (
    <AuthCard
      title="Введите код"
      subtitle={sent ? `Отправили письмо на ${email}` : `Письмо с кодом — на ${email}`}
    >
      <CodeInput
        ref={inputRef}
        value={code}
        onChange={(v) => {
          setCode(v);
          if (error) setError(null);
        }}
        onComplete={(v) => void verify(v)}
        disabled={verifying}
      />
      {/* ДВА ВХОДА ИЗ ОДНОГО ПИСЬМА (владелец 04.10: «либо по ссылке, либо
          сразу код — и так, и так принимать»): говорим об обоих. */}
      <Text
        maxFontSizeMultiplier={1.4}
        style={{ marginTop: 12, paddingHorizontal: 8, textAlign: "center", fontSize: 13, lineHeight: 18, color: t.sub }}
      >
        {kind === "signup"
          ? "Введите код из письма или нажмите в письме «Подтвердить почту»"
          : "Введите код из письма или нажмите в письме «Задать новый пароль»"}
      </Text>
      <FormError message={error} />
      <PillButton
        label={verifying ? "Проверяем…" : "Подтвердить"}
        onPress={() => void verify(code)}
        disabled={code.length !== EMAIL_CODE_LENGTH}
        loading={verifying}
      />
      <GhostLink
        label={resendLabel}
        muted={cooldown > 0 || resending}
        disabled={cooldown > 0 || resending}
        onPress={() => void resend()}
      />
      <GhostLink label="Изменить почту" muted onPress={onChangeEmail} />
      <GhostLink label="Вернуться ко входу" muted onPress={onBackToLogin} />
    </AuthCard>
  );
}
