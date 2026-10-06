import { useRef, useState } from "react";
import { uiLocale } from "@babun/shared/i18n/locale";
import { Linking, Pressable, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import {
  AuthCard,
  AuthField,
  FormError,
  InputCard,
  InputDivider,
  PasswordInput,
  PillButton,
  SwitchLink,
} from "@/components/auth/AuthCard";
import { mapAuthError, signUpHitExistingAccount } from "@/components/auth/authErrors";
import { EmailCodeCard, SIGNUP_LINK_REDIRECT } from "@/components/auth/EmailCodeCard";
import { useAuthTheme } from "@/components/auth/theme";
import { supabase } from "@/lib/supabase";
import { notify } from "@/lib/notify";
import { CAN_PAY_HERE } from "@/lib/pay-here";
import { invitationSignupErrorMessage } from "@/features/settings/invitation-flow";
import { getPendingInvitationToken } from "@/features/settings/pending-invitation";

// «Создать аккаунт» — name/email/password inline (chained return key).
// Non-functional OAuth placeholders are not shown. Terms is a one-line legal note.
// После отправки — «Введите код» из письма Babun (EmailCodeCard); верный код
// сразу открывает календарь. Мастера «название бизнеса / род занятий» больше
// нет (владелец 04.10): имя аккаунта — первое поле этой формы.
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
    const pendingInviteToken = await getPendingInvitationToken().catch(
      () => null,
    );
    const { data, error: e } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: SIGNUP_LINK_REDIRECT,
        data: {
          full_name: fullName.trim(),
          // Язык, на котором человек регистрировался, — письма ему на нём же.
          locale: uiLocale(),
          ...(pendingInviteToken
            ? { pending_invitation_token: pendingInviteToken }
            : {}),
        },
      },
    });
    if (e) {
      // With an invitation token GoTrue hides the trigger's refusal behind a
      // generic database error — name the invitation instead of a bare
      // «Не удалось создать аккаунт».
      setError(
        (pendingInviteToken && invitationSignupErrorMessage(e.message)) ||
          mapAuthError(e, "signup"),
      );
      setLoading(false);
      return;
    }
    if (signUpHitExistingAccount(data)) {
      setError(mapAuthError({ code: "user_already_exists" }, "signup"));
      setLoading(false);
      return;
    }
    if (data.session) {
      // Подтверждение почты выключено — вход уже есть. Гейт входа уводит в
      // календарь сам; спиннер держим до размонтирования экрана.
      router.replace("/");
      return;
    }
    setPending(true);
    setLoading(false);
  }

  // В приложении из магазина документ открывается своим экраном (`app/terms.tsx`,
  // `app/privacy.tsx`, без входа): там условия без способа оплаты
  // (`LEGAL_TEXTS_APP`, App Store 3.1.3(f)), а сайт в Safari показал бы полный
  // текст. На сайте — как было, ссылкой.
  const openLegal = (href: "/terms" | "/privacy") => {
    if (!CAN_PAY_HERE) {
      router.push(href);
      return;
    }
    Linking.openURL(`https://babun.app${href}`).catch(() => {
      notify(
        "Не удалось открыть ссылку",
        "Проверьте интернет и повторите.",
      );
    });
  };

  if (pending) {
    return (
      <EmailCodeCard
        kind="signup"
        email={email.trim()}
        password={password}
        onChangeEmail={() => setPending(false)}
        onBackToLogin={() => router.replace("/login")}
      />
    );
  }

  return (
    <AuthCard title="Создать аккаунт">
      <InputCard>
        <AuthField
          value={fullName}
          onChangeText={edit(setFullName)}
          placeholder="Имя или название компании"
          accessibilityLabel="Имя или название компании"
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
        Создавая аккаунт, вы принимаете документы:
      </Text>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Pressable
          onPress={() => openLegal("/terms")}
          accessibilityRole="link"
          accessibilityLabel="Условия использования"
          style={({ pressed }) => ({
            minHeight: 44,
            justifyContent: "center",
            paddingHorizontal: 8,
            opacity: pressed ? 0.65 : 1,
          })}
        >
          <Text style={{ fontSize: 13, fontWeight: "500", color: t.accent }}>
            Условия
          </Text>
        </Pressable>
        <Text style={{ fontSize: 13, color: t.sub }}>и</Text>
        <Pressable
          onPress={() => openLegal("/privacy")}
          accessibilityRole="link"
          accessibilityLabel="Политика конфиденциальности"
          style={({ pressed }) => ({
            minHeight: 44,
            justifyContent: "center",
            paddingHorizontal: 8,
            opacity: pressed ? 0.65 : 1,
          })}
        >
          <Text style={{ fontSize: 13, fontWeight: "500", color: t.accent }}>
            Конфиденциальность
          </Text>
        </Pressable>
      </View>
    </AuthCard>
  );
}
