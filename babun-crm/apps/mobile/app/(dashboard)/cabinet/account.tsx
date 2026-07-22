import { useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Smartphone, Trash2 } from "lucide-react-native";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { Divider } from "@/components/ui/Divider";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { ICON } from "@/components/ui/tokens";
import { useSession } from "@/providers/SessionProvider";
import { useThemeColors } from "@/theme/colors";
import { useToast } from "@/components/ui/Toast";
import {
  signOutAndWipe,
  signOutScopeAndWipe,
  wipeTenantScopedData,
} from "@/lib/auth-clear";
import { supabase } from "@/lib/supabase";

function Row({ label, value }: { label: string; value: string }) {
  const t = useThemeColors();
  return (
    <View className="px-4 py-3">
      <Text style={{ fontSize: 12, color: t.faint }}>{label}</Text>
      <Text style={{ marginTop: 2, fontSize: 16, color: t.ink }} selectable>
        {value}
      </Text>
    </View>
  );
}

export default function AccountScreen() {
  const { session } = useSession();
  const u = session?.user;
  const registered = u?.created_at
    ? new Date(u.created_at).toLocaleDateString("ru-RU", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "—";

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Аккаунт" />
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          className="flex-1"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 32 }}
        >
          <SectionCard>
            <Row label="Email" value={u?.email ?? "—"} />
            <Divider inset={16} />
            <Row label="Зарегистрирован" value={registered} />
            <Divider inset={16} />
            <Row label="ID пользователя" value={u?.id ?? "—"} />
          </SectionCard>

          <PasswordSection email={u?.email ?? null} />
          <DevicesSection />
          <DangerZoneSection email={u?.email ?? ""} />

          <View className="mx-3 mt-6">
            <Button
              label="Выйти"
              variant="secondary"
              tone="danger"
              // Same intentional-logout path as the cabinet hub: a bare
              // signOut() would keep all tenant data in MMKV on a shared
              // device (bare SIGNED_OUT events deliberately never wipe).
              onPress={() => void signOutAndWipe()}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

// ─── Смена пароля (web SecuritySection / PasswordBlock) ──────────────
function PasswordSection({ email }: { email: string | null }) {
  const toast = useToast();
  const [currentPwd, setCurrentPwd] = useState("");
  const [pwd, setPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  const tooShort = pwd.length > 0 && pwd.length < 8;
  const mismatch = confirm.length > 0 && pwd !== confirm;
  const samePwd = pwd.length > 0 && pwd === currentPwd;
  const canSubmit =
    currentPwd.length > 0 &&
    pwd.length >= 8 &&
    confirm === pwd &&
    !samePwd &&
    !saving;

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
            : reauthErr.message,
        );
      }
      const { error } = await supabase.auth.updateUser({ password: pwd });
      if (error) throw new Error(error.message);
      setCurrentPwd("");
      setPwd("");
      setConfirm("");
      toast("Пароль обновлён");
    } catch (e) {
      Alert.alert("Ошибка", e instanceof Error ? e.message : "Не удалось сменить пароль");
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
        placeholder="Минимум 8 символов"
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        error={
          tooShort
            ? "Минимум 8 символов"
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
      <Button
        label="Сменить пароль"
        onPress={() => void submit()}
        disabled={!canSubmit}
        loading={saving}
      />
    </SectionCard>
  );
}

// ─── Устройства: выход на других / глобальный выход ─────────────────
function DevicesSection() {
  const t = useThemeColors();
  const [busy, setBusy] = useState(false);

  // Веб-паритет (DevicesSection scope:"others"): гасит чужие сессии,
  // текущая остаётся жить — «потерял старый телефон», не «паника».
  const signOutOthers = async () => {
    setBusy(true);
    try {
      const { error } = await supabase.auth.signOut({ scope: "others" });
      if (error) throw new Error(error.message);
      Alert.alert("Готово", "Сессии на других устройствах завершены.");
    } catch (e) {
      Alert.alert(
        "Не удалось выйти",
        e instanceof Error ? e.message : "Проверьте соединение и попробуйте ещё раз.",
      );
    } finally {
      setBusy(false);
    }
  };

  const signOutEverywhere = () => {
    Alert.alert(
      "Выйти со всех устройств?",
      "Все сессии, включая это устройство, будут завершены.",
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Выйти везде",
          style: "destructive",
          onPress: async () => {
            setBusy(true);
            try {
              // scope: "global" отзывает refresh-токены всех устройств;
              // локальная сессия тоже гаснет → SessionProvider уводит на
              // логин. Wipe — только ПОСЛЕ успешного signOut (офлайн-
              // ошибка не должна уничтожать локальные данные).
              // SessionProvider waits for this helper's wipe barrier before
              // it exposes the signed-out/login tree.
              await signOutScopeAndWipe("global");
            } catch (e) {
              Alert.alert(
                "Не удалось выйти",
                e instanceof Error ? e.message : "Проверьте соединение и попробуйте ещё раз.",
              );
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  return (
    <SectionCard title="Устройства">
      <View className="flex-row items-center px-4 py-3">
        <View
          style={{
            height: 32,
            width: 32,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 8,
            backgroundColor: "rgba(44,91,224,0.10)",
          }}
        >
          <Smartphone color={t.accent} size={ICON.sm} />
        </View>
        <View className="ml-3 flex-1">
          <Text className="text-base" style={{ color: t.ink }}>
            Это устройство
          </Text>
          <Text className="text-xs" style={{ color: t.sub }}>
            В сети · текущая сессия
          </Text>
        </View>
      </View>
      <Divider inset={56} />
      <Pressable
        onPress={() => void signOutOthers()}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Выйти на других устройствах"
        className="px-4 py-3.5 active:opacity-60"
        style={{ minHeight: 44, opacity: busy ? 0.5 : 1 }}
      >
        <Text className="text-base" style={{ color: t.ink }}>
          Выйти на других устройствах
        </Text>
        <Text className="mt-0.5 text-xs" style={{ color: t.sub }}>
          Это устройство останется в системе
        </Text>
      </Pressable>
      <Divider inset={16} />
      <Pressable
        onPress={signOutEverywhere}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Выйти со всех устройств"
        className="px-4 py-3.5 active:opacity-60"
        style={{ minHeight: 44, opacity: busy ? 0.5 : 1 }}
      >
        <Text className="text-base" style={{ color: t.danger }}>
          Выйти со всех устройств
        </Text>
      </Pressable>
    </SectionCard>
  );
}

// ─── Опасная зона: удаление аккаунта (App Store 5.1.1(v)) ────────────
//
// Native self-service deletion goes straight to a Supabase Edge Function.
// There is no dependency on the abandoned Next application: auth-js attaches
// the current access token, while the function validates it again before any
// service-role cascade.

function DangerZoneSection({ email }: { email: string }) {
  const t = useThemeColors();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const targetPhrase = email.trim() || "УДАЛИТЬ";
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
        { body: { confirmation: typed.trim() } },
      );
      if (invokeError) throw new Error(invokeError.message);
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
      setError(
        caught instanceof Error
          ? caught.message
          : "Не удалось удалить аккаунт",
      );
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
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
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
              Введите {email ? "email аккаунта" : "УДАЛИТЬ"} для подтверждения. Все данные будут потеряны.
            </Text>
            <Text style={{ marginBottom: 6, fontSize: 13, color: t.ink }} selectable>
              {targetPhrase}
            </Text>
            <Field
              label="Подтверждение"
              value={typed}
              onChangeText={setTyped}
              placeholder={targetPhrase}
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
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}
