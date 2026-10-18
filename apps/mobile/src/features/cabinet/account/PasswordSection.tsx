import { useState } from "react";
import { Text } from "react-native";
import { SectionCard } from "@/components/ui/SectionCard";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { useThemeColors } from "@/theme/colors";
import { useToast } from "@/components/ui/Toast";
import { supabase } from "@/lib/supabase";
import { notify } from "@/lib/notify";
import { writeErrorWords } from "@/lib/connection-words";
import { PASSWORD_MIN, passwordTooShort } from "@/components/auth/password-rule";
import { passwordRefusal } from "@/features/cabinet/account-errors";

// ─── Смена пароля (web SecuritySection / PasswordBlock) ──────────────
export function PasswordSection({ email }: { email: string | null }) {
  const t = useThemeColors();
  const toast = useToast();
  const [currentPwd, setCurrentPwd] = useState("");
  const [pwd, setPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  const tooShort = passwordTooShort(pwd);
  const mismatch = confirm.length > 0 && pwd !== confirm;
  const samePwd = pwd.length > 0 && pwd === currentPwd;
  const canSubmit =
    currentPwd.length > 0 &&
    pwd.length >= PASSWORD_MIN &&
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
      // v678 P0-9 (web parity) — challenge с текущим паролем: сам
      // updateUser({password}) Supabase его не требует, а без проверки
      // угнанная сессия молча выкидывает владельца из аккаунта.
      const { error: reauthErr } = await supabase.auth.signInWithPassword({
        email,
        password: currentPwd,
      });
      if (reauthErr) {
        throw new Error(
          /invalid|credentials/i.test(reauthErr.message)
            ? "Текущий пароль введён неверно."
            : passwordRefusal(reauthErr.message),
        );
      }
      const { error } = await supabase.auth.updateUser({ password: pwd });
      if (error) throw new Error(passwordRefusal(error.message));
      setCurrentPwd("");
      setPwd("");
      setConfirm("");
      toast("Пароль обновлён");
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

  return (
    <SectionCard title="Безопасность" padded>
      <Field
        label="Текущий пароль"
        value={currentPwd}
        onChangeText={setCurrentPwd}
        placeholder="Введите текущий пароль"
        secureTextEntry
        autoComplete="current-password"
        textContentType="password"
      />
      <Field
        label="Новый пароль"
        value={pwd}
        onChangeText={setPwd}
        placeholder="Минимум 6 символов"
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        error={
          tooShort
            ? "Минимум 6 символов"
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
        autoComplete="new-password"
        textContentType="newPassword"
        error={mismatch ? "Пароли не совпадают" : null}
      />
      {hint ? (
        <Text
          accessibilityLiveRegion="polite"
          style={{ marginBottom: 8, fontSize: 13, lineHeight: 18, color: t.sub }}
        >
          {hint}
        </Text>
      ) : null}
      <Button
        label="Сменить пароль"
        onPress={() => void submit()}
        disabled={!canSubmit}
        loading={saving}
      />
    </SectionCard>
  );
}
