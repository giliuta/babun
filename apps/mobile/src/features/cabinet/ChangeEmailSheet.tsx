import { useEffect, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Field } from "@/components/ui/Field";
import { GradientButton } from "@/components/ui/GradientButton";
import { CodeInput, EMAIL_CODE_LENGTH } from "@/components/auth/CodeInput";
import { mapAuthError } from "@/components/auth/authErrors";
import { changeEmailRefusal } from "@/features/cabinet/change-email";
import { SIGNUP_LINK_REDIRECT } from "@/components/auth/EmailCodeCard";
import { useToast } from "@/components/ui/Toast";
import { useThemeColors } from "@/theme/colors";
import { supabase } from "@/lib/supabase";

const RESEND_COOLDOWN_S = 60;

// СМЕНА ПОЧТЫ АККАУНТА (04.10, перед выпуском в магазины). Раньше почту
// нельзя было поменять вовсе. Новая почта → код из письма на НЕЁ → готово:
// пока код не введён, вход остаётся по старой. Письмо — шаблон Supabase
// «Change email address» (код + кнопка), старый адрес получает уведомление
// «Email address changed». Право — само владение аккаунтом: менять можно
// только свою почту, сервер Supabase Auth проверяет вход.
export function ChangeEmailSheet({
  visible,
  onClose,
  currentEmail,
}: {
  visible: boolean;
  onClose: () => void;
  currentEmail: string;
}) {
  const t = useThemeColors();
  const toast = useToast();
  const codeRef = useRef<TextInput>(null);
  const [email, setEmail] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (!visible) {
      setEmail("");
      setStep("email");
      setCode("");
      setError(null);
      setBusy(false);
    }
  }, [visible]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const next = email.trim().toLowerCase();
  const canSend =
    !busy && next.includes("@") && next !== currentEmail.toLowerCase();

  async function sendCode() {
    if (!canSend && step === "email") return;
    if (step === "code" && (cooldown > 0 || busy)) return;
    setBusy(true);
    setError(null);
    const { error: e } = await supabase.auth.updateUser(
      { email: next },
      { emailRedirectTo: SIGNUP_LINK_REDIRECT },
    );
    setBusy(false);
    if (e) {
      setError(changeEmailRefusal(e));
      return;
    }
    setStep("code");
    setCode("");
    setCooldown(RESEND_COOLDOWN_S);
  }

  async function verify(token: string) {
    if (busy || token.length !== EMAIL_CODE_LENGTH) return;
    setBusy(true);
    setError(null);
    const { error: e } = await supabase.auth.verifyOtp({
      email: next,
      token,
      type: "email_change",
    });
    setBusy(false);
    if (e) {
      setError(mapAuthError(e, "code"));
      setCode("");
      codeRef.current?.focus();
      return;
    }
    toast("Почта изменена");
    onClose();
  }

  const footer =
    step === "email" ? (
      <GradientButton
        label={busy ? "Отправляем…" : "Отправить код"}
        onPress={() => void sendCode()}
        disabled={!canSend}
        loading={busy}
      />
    ) : (
      <GradientButton
        label={busy ? "Проверяем…" : "Подтвердить"}
        onPress={() => void verify(code)}
        disabled={code.length !== EMAIL_CODE_LENGTH || busy}
        loading={busy}
      />
    );

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Новая почта"
      subtitle={step === "code" ? `Код отправлен на ${next}` : currentEmail}
      footer={footer}
      avoidKeyboard
    >
      {step === "email" ? (
        <Field
          label=""
          accessibilityLabel="Новая почта"
          placeholder="Почта"
          value={email}
          onChangeText={(v) => {
            setEmail(v);
            if (error) setError(null);
          }}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          inputMode="email"
          textContentType="emailAddress"
          autoFocus
          returnKeyType="send"
          onSubmitEditing={() => void sendCode()}
          error={error}
        />
      ) : (
        <View>
          <CodeInput
            ref={codeRef}
            value={code}
            onChange={(v) => {
              setCode(v);
              if (error) setError(null);
            }}
            onComplete={(v) => void verify(v)}
            disabled={busy}
          />
          <Text style={{ marginTop: 12, textAlign: "center", fontSize: 13, lineHeight: 18, color: t.sub }}>
            Введите код из письма или нажмите в письме «Подтвердить почту»
          </Text>
          {error ? (
            <Text style={{ marginTop: 8, textAlign: "center", fontSize: 13, color: t.danger }}>
              {error}
            </Text>
          ) : null}
          <Text
            onPress={cooldown > 0 || busy ? undefined : () => void sendCode()}
            accessibilityRole="button"
            style={{
              marginTop: 16,
              paddingVertical: 10,
              textAlign: "center",
              fontSize: 14,
              fontWeight: "500",
              color: cooldown > 0 ? t.sub : t.accent,
            }}
          >
            {cooldown > 0 ? `Отправить ещё раз (${cooldown})` : "Отправить ещё раз"}
          </Text>
        </View>
      )}
    </BottomSheet>
  );
}
