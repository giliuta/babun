import { useState } from "react";
import { Text, View } from "react-native";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { ActionRow } from "@/components/ui/card-rows";
import { Trash2 } from "lucide-react-native";
import { SectionCard } from "@/components/ui/SectionCard";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { useThemeColors } from "@/theme/colors";
import { wipeTenantScopedData } from "@/lib/auth-clear";
import { supabase } from "@/lib/supabase";
import { isHumanText } from "@babun/shared/i18n/runtime";
import { deleteRefusal } from "@/features/cabinet/account-errors";

// ─── Опасная зона: удаление аккаунта (App Store 5.1.1(v)) ────────────
//
// Native self-service deletion goes straight to a Supabase Edge Function.
// There is no dependency on the abandoned Next application: auth-js attaches
// the current access token, while the function validates it again before any
// service-role cascade.

export function DangerZoneSection({ email }: { email: string }) {
  const t = useThemeColors();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Запасное слово — данные: account-delete сверяет его с русским «УДАЛИТЬ»,
  // поэтому оно не переводится ни здесь, ни в подсказке ниже.
  const targetPhrase = email.trim() || /* i18n-ignore */ "УДАЛИТЬ";
  const ready =
    typed.trim().length > 0 &&
    typed.trim().toLowerCase() === targetPhrase.toLowerCase();

  const deleteAccount = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke(
        "account-delete",
        // Своя минута вместо общего потолка 12 с (lib/supabase.ts): функция
        // делает около дюжины шагов подряд, и обрыв на полпути показывал
        // «не удалось», пока сервер дочищал аккаунт, — повтор упирался в 401.
        { body: { confirmation: typed.trim() }, timeout: 60_000 },
      );
      if (invokeError) throw await deleteRefusal(invokeError);
      if (!data || data.ok !== true) {
        throw new Error(
          typeof data?.error === "string" ? data.error : "Не удалось удалить аккаунт",
        );
      }

      // The remote user no longer exists, so local data must be wiped even if
      // auth-js can't revoke an already-deleted server session.
      await wipeTenantScopedData();
      await supabase.auth.signOut({ scope: "local" });
      setOpen(false);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "";
      setError(isHumanText(message) ? message : "Не удалось удалить аккаунт. Попробуйте ещё раз.");
      setBusy(false);
    }
  };

  const openSheet = () => {
    setTyped("");
    setError(null);
    setOpen(true);
  };

  return (
    <>
      {/* ВХОД — СТРОКА СПИСКА, А НЕ ВТОРАЯ КНОПКА-ПИЛЮЛЯ: красная `ActionRow`
          со значком, как «Выйти со всех устройств» выше. */}
      <SectionCard title="Опасная зона" padded={false}>
        <Text className="px-4 pt-1 text-sm leading-5" style={{ color: t.sub }}>
          Удаление аккаунта необратимо. Будут стёрты все клиенты, записи и
          настройки.
        </Text>
        <ActionRow label="Удалить аккаунт" tone="danger" icon={Trash2} onPress={openSheet} />
      </SectionCard>

      {/* ПОДТВЕРЖДЕНИЕ — КАНОНИЧЕСКИЙ ЛИСТ (AGENTS Canon Reuse п.5): шапка,
          поле, «Удалить» в футере. Пока идёт удаление, лист не закрывается. */}
      <BottomSheet
        visible={open}
        onClose={() => !busy && setOpen(false)}
        title="Удалить аккаунт?"
        avoidKeyboard
        footer={
          <Button
            label="Удалить"
            tone="danger"
            disabled={!ready || busy}
            loading={busy}
            onPress={() => void deleteAccount()}
          />
        }
      >
        <View style={{ paddingHorizontal: 16 }}>
          <Text style={{ marginBottom: 12, fontSize: 14, lineHeight: 20, color: t.sub }}>
            Введите {email ? "email аккаунта" : /* i18n-ignore */ "УДАЛИТЬ"} для подтверждения. Все данные будут потеряны.
          </Text>
          <Field
            label="Подтверждение"
            value={typed}
            onChangeText={setTyped}
            placeholder={targetPhrase}
            keyboardType={email ? "email-address" : "default"}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy}
            error={error}
          />
        </View>
      </BottomSheet>
    </>
  );
}
