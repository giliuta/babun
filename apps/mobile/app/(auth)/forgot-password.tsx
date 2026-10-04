import { useState } from "react";
import { useRouter } from "expo-router";
import * as Linking from "expo-linking";
import {
  AuthCard,
  AuthField,
  FormError,
  GhostLink,
  InputCard,
  PillButton,
} from "@/components/auth/AuthCard";
import { supabase } from "@/lib/supabase";

// «Сброс пароля»: почта → код из письма Babun (владелец 04.10: «сброс пароля
// идёт тем же кодом»). Код вводится на экране нового пароля — там же сессия
// восстановления переживает гейт входа. Ответ один и тот же, есть такой адрес
// или нет (anti-enumeration). Кнопка в письме ведёт туда же ссылкой.
export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (loading || email.trim().length === 0) return;
    setLoading(true);
    setError(null);
    const { error: e } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: Linking.createURL("/reset-password"),
    });
    setLoading(false);
    if (e) {
      const m = (e.message ?? "").toLowerCase();
      if (m.includes("rate") || m.includes("too many"))
        setError("Слишком много попыток, подождите минуту");
      else setError("Нет связи. Проверьте интернет и повторите");
      return;
    }
    router.push({ pathname: "/reset-password", params: { email: email.trim() } });
  }

  return (
    <AuthCard title="Сброс пароля" subtitle="Введите email — пришлём код">
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
