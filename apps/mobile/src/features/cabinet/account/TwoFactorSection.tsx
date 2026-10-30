import { useEffect, useRef, useState } from "react";
import { Linking, Platform, Pressable, Text, View, type TextInput } from "react-native";
import { ShieldCheck } from "lucide-react-native";
import { SvgXml } from "react-native-svg";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { TYPE } from "@/components/ui/tokens";
import { useToast } from "@/components/ui/Toast";
import { CodeInput, EMAIL_CODE_LENGTH } from "@/components/auth/CodeInput";
import { mapAuthError } from "@/components/auth/authErrors";
import { confirmAction } from "@/lib/confirm";
import { useCopyValue } from "@/lib/copy-value";
import { notify } from "@/lib/notify";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/providers/SessionProvider";
import { useThemeColors } from "@/theme/colors";
import { groupedSecret, qrSvgOf } from "./two-factor";

// ДВУХФАКТОРНЫЙ ВХОД — строка в «Безопасности» и лист включения.
//
// Включить: лист показывает QR для приложения-аутентификатора (Google
// Authenticator, 1Password, Authy…), под ним ключ текстом — на телефоне QR со
// своего же экрана не сканируют, — и «Открыть в приложении» (ссылка
// otpauth://). Дальше — шесть цифр из приложения: верный код подтверждает
// фактор, и со следующего входа после пароля спрашивается код
// (`lib/mfa/assurance.ts`, экран `(auth)/mfa`). Закрыли лист, не введя код, —
// недоделанный фактор снимается: висящий неподтверждённый фактор мешал бы
// следующей попытке.
//
// Выключить: вопрос и снятие фактора. Сессия после входа с кодом — второго
// уровня, этого сервер и требует для снятия.

const FACTORS_KEY = "mfa-factors";

/** Подтверждённый фактор TOTP человека — или null. Читается с сервера:
 *  `user.factors` в сессии после снятия фактора остаётся старым до
 *  обновления токена. */
export function useTotpFactor() {
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  return useQuery({
    queryKey: [FACTORS_KEY, userId],
    enabled: !!userId,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) throw new Error(error.message);
      return data.totp.find((f) => f.status === "verified") ?? null;
    },
  });
}

export function TwoFactorRow() {
  const factor = useTotpFactor();
  const qc = useQueryClient();
  const toast = useToast();
  const [sheet, setSheet] = useState(false);
  const on = !!factor.data;

  const turnOff = async () => {
    const id = factor.data?.id;
    if (!id) return;
    const ok = await confirmAction("Выключить двухфакторный вход?", {
      message: "При входе код из приложения больше не спросим — хватит пароля.",
      confirmLabel: "Выключить",
      destructive: true,
    });
    if (!ok) return;
    const { error } = await supabase.auth.mfa.unenroll({ factorId: id });
    if (error) {
      notify("Не удалось выключить", "Проверьте соединение и попробуйте ещё раз.");
      return;
    }
    await qc.invalidateQueries({ queryKey: [FACTORS_KEY] });
    toast("Двухфакторный вход выключен");
  };

  return (
    <>
      <SettingsRow
        tile={SETTINGS_TILE.green}
        icon={ShieldCheck}
        title="Двухфакторный вход"
        sub={factor.isPending ? undefined : on ? "Включён · код из приложения при входе" : "Выключен"}
        onPress={factor.isPending ? undefined : on ? () => void turnOff() : () => setSheet(true)}
      />
      <TwoFactorSheet
        visible={sheet}
        onClose={() => setSheet(false)}
        onEnabled={() => {
          setSheet(false);
          void qc.invalidateQueries({ queryKey: [FACTORS_KEY] });
          toast("Двухфакторный вход включён");
        }}
      />
    </>
  );
}

type Enrollment = { id: string; svg: string | null; secret: string; uri: string };

function TwoFactorSheet({
  visible,
  onClose,
  onEnabled,
}: {
  visible: boolean;
  onClose: () => void;
  onEnabled: () => void;
}) {
  const t = useThemeColors();
  const copy = useCopyValue();
  const codeRef = useRef<TextInput>(null);
  const [step, setStep] = useState<"scan" | "code">("scan");
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [failed, setFailed] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const verified = useRef(false);

  // ОТКРЫЛИ — НОВЫЙ ФАКТОР. Прежние недоделанные снимаются: имя фактора у
  // человека одно, и второй «Babun» сервер не заведёт.
  useEffect(() => {
    if (!visible) return;
    let live = true;
    verified.current = false;
    setStep("scan");
    setCode("");
    setError(null);
    setFailed(false);
    setEnrollment(null);
    void (async () => {
      const { data: list } = await supabase.auth.mfa.listFactors();
      for (const stale of list?.all.filter((f) => f.factor_type === "totp" && f.status === "unverified") ?? []) {
        await supabase.auth.mfa.unenroll({ factorId: stale.id });
      }
      const { data, error: e } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Babun" });
      if (!live) return;
      if (e || !data) {
        setFailed(true);
        return;
      }
      setEnrollment({ id: data.id, svg: qrSvgOf(data.totp.qr_code), secret: data.totp.secret, uri: data.totp.uri });
    })();
    return () => {
      live = false;
    };
  }, [visible]);

  // Закрыли, не подтвердив, — недоделанный фактор снимаем.
  const close = () => {
    if (enrollment && !verified.current) {
      void supabase.auth.mfa.unenroll({ factorId: enrollment.id });
    }
    onClose();
  };

  const verify = async (token: string) => {
    if (!enrollment || busy || token.length !== EMAIL_CODE_LENGTH) return;
    setBusy(true);
    setError(null);
    const { error: e } = await supabase.auth.mfa.challengeAndVerify({ factorId: enrollment.id, code: token });
    setBusy(false);
    if (e) {
      setError(mapAuthError(e, "totp"));
      setCode("");
      codeRef.current?.focus();
      return;
    }
    verified.current = true;
    onEnabled();
  };

  const openInApp = async () => {
    if (!enrollment) return;
    try {
      await Linking.openURL(enrollment.uri);
    } catch {
      notify("Приложение не открылось", "Добавьте ключ в приложение-аутентификатор вручную.");
    }
  };

  const footer =
    step === "scan" ? (
      <Button label="Дальше" onPress={() => setStep("code")} disabled={!enrollment} />
    ) : (
      <Button
        label={busy ? "Проверяем…" : "Включить"}
        onPress={() => void verify(code)}
        disabled={code.length !== EMAIL_CODE_LENGTH || busy}
        loading={busy}
      />
    );

  return (
    <BottomSheet
      visible={visible}
      onClose={close}
      title="Двухфакторный вход"
      subtitle={step === "scan" ? "Добавьте Babun в приложение-аутентификатор" : "Введите код из приложения"}
      footer={footer}
      avoidKeyboard
    >
      {step === "scan" ? (
        <View style={{ alignItems: "center", gap: 12 }}>
          {failed ? (
            <Text style={{ ...TYPE.body, color: t.danger, textAlign: "center" }}>
              Не удалось начать. Закройте и попробуйте ещё раз.
            </Text>
          ) : enrollment?.svg ? (
            // QR — на белом, как бумага: тёмная тема не должна гасить поле кода.
            <View style={{ padding: 12, borderRadius: t.radius.input, backgroundColor: "#FFFFFF" }}>
              <SvgXml xml={enrollment.svg} width={184} height={184} />
            </View>
          ) : (
            <View style={{ width: 208, height: 208 }} />
          )}
          {enrollment ? (
            <>
              <Text style={{ ...TYPE.subhead, color: t.sub, textAlign: "center" }}>
                Отсканируйте QR или введите ключ вручную
              </Text>
              <Pressable
                onPress={() => copy(enrollment.secret)}
                accessibilityRole="button"
                accessibilityLabel="Скопировать ключ"
                style={{ paddingVertical: 6 }}
              >
                <Text
                  selectable
                  style={{ ...TYPE.callout, color: t.ink, textAlign: "center", fontVariant: ["tabular-nums"] }}
                >
                  {groupedSecret(enrollment.secret)}
                </Text>
                <Text style={{ ...TYPE.subhead, color: t.accent, textAlign: "center", marginTop: 4 }}>
                  Скопировать ключ
                </Text>
              </Pressable>
              {/* На телефоне приложение-аутентификатор рядом: ссылка добавит
                  Babun в него сама. На компьютере QR сканируют телефоном. */}
              {Platform.OS !== "web" ? (
                <Text
                  onPress={() => void openInApp()}
                  accessibilityRole="button"
                  style={{ ...TYPE.callout, color: t.accent, paddingVertical: 8 }}
                >
                  Открыть в приложении
                </Text>
              ) : null}
            </>
          ) : null}
        </View>
      ) : (
        <View>
          <CodeInput
            ref={codeRef}
            label="Код из приложения"
            value={code}
            onChange={(v) => {
              setCode(v);
              if (error) setError(null);
            }}
            onComplete={(v) => void verify(v)}
            disabled={busy}
          />
          {error ? (
            <Text style={{ ...TYPE.subhead, marginTop: 8, textAlign: "center", color: t.danger }}>{error}</Text>
          ) : null}
        </View>
      )}
    </BottomSheet>
  );
}
