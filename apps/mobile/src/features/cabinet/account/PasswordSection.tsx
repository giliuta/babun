import { useEffect, useState } from "react";
import { Text } from "react-native";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { useGuardedClose } from "@/components/ui/use-guarded-close";
import { useThemeColors } from "@/theme/colors";
import { useToast } from "@/components/ui/Toast";
import { supabase } from "@/lib/supabase";
import { notify } from "@/lib/notify";
import { writeErrorWords } from "@/lib/connection-words";
import { passwordAccepted, passwordHint } from "@/components/auth/password-rule";
import { passwordRefusal } from "@/features/cabinet/account-errors";
import { PASSWORD_KEYBOARD } from "@/lib/keyboard";

// ─── Смена пароля: лист с тремя полями, кнопка — в футере ───────────
export function PasswordSheet({
  visible,
  onClose,
  email,
  totpFactorId = null,
}: {
  visible: boolean;
  onClose: () => void;
  email: string | null;
  /** Двухфакторный вход включён — вместо текущего пароля код из
   *  приложения. Перепроверка паролем выдала бы сессию первого уровня, и
   *  посреди работы человека увело бы на экран кода; а код из приложения и
   *  есть второй, более сильный ключ. */
  totpFactorId?: string | null;
}) {
  const t = useThemeColors();
  const toast = useToast();
  const [currentPwd, setCurrentPwd] = useState("");
  const [pwd, setPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) {
      setCurrentPwd("");
      setPwd("");
      setConfirm("");
    }
  }, [visible]);

  const pwdHint = passwordHint(pwd);
  const mismatch = confirm.length > 0 && pwd !== confirm;
  const byCode = !!totpFactorId;
  const samePwd = !byCode && pwd.length > 0 && pwd === currentPwd;
  const canSubmit =
    (byCode ? /^\d{6}$/.test(currentPwd) : currentPwd.length > 0) &&
    passwordAccepted(pwd) &&
    confirm === pwd &&
    !samePwd &&
    !saving;
  // ПОГАШЕННАЯ КНОПКА НАЗЫВАЕТ ПРИЧИНУ (закон продукта). Короткий пароль,
  // совпадение с текущим и расхождение подтверждения уже подписаны у своих
  // полей; молчали только ПУСТЫЕ поля — и прежде всего «текущий пароль»:
  // человек набирал новый дважды, а кнопка оставалась серой без единого слова.
  //
  // ОДНОЙ СТРОКОЙ И НЕ ЭХОМ ПОДСКАЗОК. Пошаговое «Введите текущий пароль»
  // дословно повторяло плейсхолдер поля строкой выше — одна фраза дважды на
  // одном экране. Поля и так называют себя; кнопке нужно сказать только, что
  // заполнено не всё.
  const hint =
    !saving && (!currentPwd || !pwd || !confirm)
      ? "Заполните все три поля"
      : null;

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      if (!email) {
        throw new Error("Не удалось определить email аккаунта. Войдите заново.");
      }
      // Перепроверка перед сменой: сам updateUser({password}) Supabase её не
      // требует, а без неё угнанная сессия молча выкидывает владельца из
      // аккаунта. При двухфакторном входе — кодом из приложения.
      if (totpFactorId) {
        const { error: codeErr } = await supabase.auth.mfa.challengeAndVerify({
          factorId: totpFactorId,
          code: currentPwd,
        });
        if (codeErr) throw new Error("Неверный код из приложения.");
      }
      const { error: reauthErr } = byCode
        ? { error: null }
        : await supabase.auth.signInWithPassword({ email, password: currentPwd });
      if (reauthErr) {
        throw new Error(
          /invalid|credentials/i.test(reauthErr.message)
            ? "Текущий пароль введён неверно."
            : passwordRefusal(reauthErr.message),
        );
      }
      const { error } = await supabase.auth.updateUser({ password: pwd });
      if (error) throw new Error(passwordRefusal(error.message));
      toast("Пароль обновлён");
      onClose();
    } catch (e) {
      const words = writeErrorWords(e, {
        failed: "Не удалось сменить пароль",
        notDone: "Пароль прежний",
      });
      notify(words.title, words.subtitle);
    } finally {
      setSaving(false);
    }
  };

  // Набранные пароли случайным свайпом не стираются — сначала вопрос.
  const guard = useGuardedClose({
    dirty: currentPwd !== "" || pwd !== "" || confirm !== "",
    busy: saving,
    onClose,
    message: "Набранные пароли не сохранятся.",
  });

  return (
    <BottomSheet
      visible={visible && !guard.hidden}
      onClose={guard.close}
      onExited={guard.onExited}
      title="Сменить пароль"
      avoidKeyboard
      footer={
        <Button
          label="Сменить пароль"
          onPress={() => void submit()}
          disabled={!canSubmit}
          loading={saving}
        />
      }
    >
      {byCode ? (
        <Field
          label="Код из приложения"
          value={currentPwd}
          onChangeText={(v) => setCurrentPwd(v.replace(/\D/g, "").slice(0, 6))}
          placeholder="Шесть цифр"
          keyboardType="number-pad"
          inputMode="numeric"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          maxLength={6}
        />
      ) : (
        <Field
          label="Текущий пароль"
          value={currentPwd}
          onChangeText={setCurrentPwd}
          placeholder="Введите текущий пароль"
          secureTextEntry
          keyboardType={PASSWORD_KEYBOARD}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="current-password"
          textContentType="password"
        />
      )}
      <Field
        label="Новый пароль"
        value={pwd}
        onChangeText={setPwd}
        placeholder="Минимум 6 символов"
        secureTextEntry
        keyboardType={PASSWORD_KEYBOARD}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="new-password"
        textContentType="newPassword"
        error={
          pwdHint
            ? pwdHint
            : samePwd
              ? "Новый пароль должен отличаться от текущего"
              : null
        }
      />
      <Field
        label="Подтвердите новый пароль"
        value={confirm}
        onChangeText={setConfirm}
        placeholder="Повторите новый пароль"
        secureTextEntry
        keyboardType={PASSWORD_KEYBOARD}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="new-password"
        textContentType="newPassword"
        error={mismatch ? "Пароли не совпадают" : null}
      />
      {hint ? (
        <Text
          accessibilityLiveRegion="polite"
          style={{ fontSize: 13, lineHeight: 18, color: t.sub }}
        >
          {hint}
        </Text>
      ) : null}
    </BottomSheet>
  );
}
