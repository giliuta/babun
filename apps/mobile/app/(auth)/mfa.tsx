import { useRef, useState } from "react";
import { Text, type TextInput } from "react-native";
import { AuthCard, FormError, GhostLink, PillButton } from "@/components/auth/AuthCard";
import { CodeInput, EMAIL_CODE_LENGTH } from "@/components/auth/CodeInput";
import { mapAuthError } from "@/components/auth/authErrors";
import { useAuthTheme } from "@/components/auth/theme";
import { signOutAndWipe } from "@/lib/auth-clear";
import { supabase } from "@/lib/supabase";

// ВТОРОЙ ШАГ ВХОДА — «КОД ИЗ ПРИЛОЖЕНИЯ». Сюда гейт входа ведёт всякого, кто
// вошёл первым шагом (пароль, Google, Apple, ссылка из письма), когда у него
// включён двухфакторный вход (`lib/mfa/assurance.ts`). Верный код поднимает
// сессию до второго уровня — событие `MFA_CHALLENGE_VERIFIED`, — и гейт сам
// уводит в приложение; экран только держит спиннер до размонтирования.
// Код у приложения-аутентификатора тоже из шести цифр — клетки те же, что у
// кода из письма.
export default function SecondStepScreen() {
  const t = useAuthTheme();
  const inputRef = useRef<TextInput>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  async function verify(token: string) {
    if (verifying || token.length !== EMAIL_CODE_LENGTH) return;
    setVerifying(true);
    setError(null);
    const { data, error: listError } = await supabase.auth.mfa.listFactors();
    const factor = data?.totp.find((f) => f.status === "verified");
    const { error: e } = factor
      ? await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: token })
      : { error: listError ?? { message: "factor not found" } };
    if (e) {
      setVerifying(false);
      setError(mapAuthError(e, "totp"));
      setCode("");
      inputRef.current?.focus();
    }
  }

  return (
    <AuthCard title="Код из приложения" subtitle="Двухфакторный вход включён">
      <CodeInput
        ref={inputRef}
        label="Код из приложения"
        value={code}
        onChange={(v) => {
          setCode(v);
          if (error) setError(null);
        }}
        onComplete={(v) => void verify(v)}
        disabled={verifying}
      />
      <Text
        maxFontSizeMultiplier={1.4}
        style={{ marginTop: 12, paddingHorizontal: 8, textAlign: "center", fontSize: 13, lineHeight: 18, color: t.sub }}
      >
        Откройте приложение-аутентификатор и введите шесть цифр для Babun
      </Text>
      <FormError message={error} />
      <PillButton
        label={verifying ? "Проверяем…" : "Войти"}
        onPress={() => void verify(code)}
        disabled={code.length !== EMAIL_CODE_LENGTH}
        loading={verifying}
      />
      {/* Нет телефона с приложением — выйти и войти другим аккаунтом. */}
      <GhostLink label="Выйти" muted onPress={() => void signOutAndWipe()} />
    </AuthCard>
  );
}
