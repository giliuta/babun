import { useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { KeyboardLift } from "@/components/ui/KeyboardLift";
import { Trash2 } from "lucide-react-native";
import { SectionCard } from "@/components/ui/SectionCard";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { ICON } from "@/components/ui/tokens";
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

  return (
    <>
      <SectionCard title="Опасная зона" padded>
        <Text className="mb-3 text-sm leading-5" style={{ color: t.sub }}>
          Удаление аккаунта необратимо. Будут стёрты все клиенты, записи и
          настройки.
        </Text>
        <Pressable
          onPress={() => {
            setTyped("");
            setError(null);
            setOpen(true);
          }}
          accessibilityRole="button"
          accessibilityLabel="Удалить аккаунт"
          className="flex-row items-center justify-center rounded-full border py-3.5 active:opacity-70"
          style={{
            minHeight: 48,
            borderColor: t.danger + "4d",
            backgroundColor: t.danger + "1a",
          }}
        >
          <Trash2 color={t.danger} size={ICON.xs} />
          <Text className="ml-2 text-base font-semibold" style={{ color: t.danger }}>
            Удалить аккаунт
          </Text>
        </Pressable>
      </SectionCard>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => !busy && setOpen(false)}
      >
        <KeyboardLift
          style={{ flex: 1, justifyContent: "center", padding: 20, backgroundColor: t.scrim }}
        >
          <View
            accessibilityRole="alert"
            style={{
              borderRadius: t.radius.card,
              backgroundColor: t.surface,
              padding: 20,
              boxShadow: t.cardShadow,
            }}
          >
            <Text style={{ fontSize: 20, fontWeight: "700", color: t.danger }}>
              Удалить аккаунт?
            </Text>
            <Text style={{ marginTop: 8, marginBottom: 16, fontSize: 14, lineHeight: 20, color: t.sub }}>
              Введите {email ? "email аккаунта" : /* i18n-ignore */ "УДАЛИТЬ"} для подтверждения. Все данные будут потеряны.
            </Text>
            <Text style={{ marginBottom: 6, fontSize: 13, color: t.ink }} selectable>
              {targetPhrase}
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
            <View className="mt-4 flex-row gap-2">
              <View className="flex-1">
                <Button
                  label="Отмена"
                  variant="secondary"
                  disabled={busy}
                  onPress={() => setOpen(false)}
                />
              </View>
              <View className="flex-1">
                <Button
                  label="Удалить"
                  variant="secondary"
                  tone="danger"
                  disabled={!ready || busy}
                  loading={busy}
                  onPress={() => void deleteAccount()}
                />
              </View>
            </View>
          </View>
        </KeyboardLift>
      </Modal>
    </>
  );
}
