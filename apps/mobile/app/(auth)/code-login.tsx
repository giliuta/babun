import { useState } from "react";
import { useRouter } from "expo-router";
import {
  AuthCard,
  AuthField,
  FormError,
  GhostLink,
  InputCard,
  PillButton,
} from "@/components/auth/AuthCard";
import { mapAuthError } from "@/components/auth/authErrors";
import { EmailCodeCard, sendSignInCode } from "@/components/auth/EmailCodeCard";

// «Вход по коду» — без пароля (владелец 04.10, «давай»): почта → код из
// письма Babun → календарь. Только в существующий аккаунт; регистрация — своя
// форма с именем и паролем. Верный код создаёт сессию, и гейт входа уводит
// с экрана сам.
export default function CodeLoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit() {
    if (loading || email.trim().length === 0) return;
    setLoading(true);
    setError(null);
    const { error: e } = await sendSignInCode(email.trim());
    setLoading(false);
    if (e) {
      const m = (e.message ?? "").toLowerCase();
      const c = (e.code ?? "").toLowerCase();
      if (c.includes("otp_disabled") || m.includes("signups not allowed"))
        setError("Аккаунта с такой почтой нет — зарегистрируйтесь");
      else setError(mapAuthError(e, "code"));
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <EmailCodeCard
        kind="signin"
        email={email.trim()}
        onChangeEmail={() => setSent(false)}
        onBackToLogin={() => router.replace("/login")}
      />
    );
  }

  return (
    <AuthCard title="Вход по коду" subtitle="Введите email — пришлём код">
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
        label={loading ? "Отправляем…" : "Отправить код"}
        onPress={submit}
        disabled={email.trim().length === 0}
        loading={loading}
      />

      <GhostLink label="Вернуться ко входу" muted onPress={() => router.replace("/login")} />
    </AuthCard>
  );
}
