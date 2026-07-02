// Создание клиента = ЭТА ЖЕ карточка (LOCKED client-app.html «new» mode +
// client-card-create.html): one screen, not a form. ТЕЛЕФОН первичен —
// big title input, autofocused, save-gate on «Готово»; имя вторично (одна
// строка ниже, «можно позже»). Everything else is added on the client
// card right after save (router.replace → /clients/[id] opens the lean
// card with its add-rows).
//
// Inline dedup (clients-99 F1.5): the phone is checked live (debounced)
// against phone_e164; a hit shows «Похоже, такой уже есть» with «Открыть»
// instead of silently creating a dup. «Готово» while the banner is up
// force-creates (web escape hatch parity). E.164 normalization reuses the
// Wave-1 tryToE164.

import { useEffect, useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { Check, ChevronLeft } from "lucide-react-native";
import type { Client } from "@babun/shared/local/clients";
import { findClientByPhoneE164 } from "@babun/shared/db/repositories/clients";
import { Card } from "@/components/ui/Card";
import { Screen } from "@/components/ui/Screen";
import { useBookingNav } from "@/features/clients/card-booking";
import { useCreateClient } from "@/features/clients/queries";
import { tryToE164 } from "@/features/clients/phone";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { useThemeColors } from "@/theme/colors";

export default function NewClientScreen() {
  const t = useThemeColors();
  const router = useRouter();
  const tenantId = useTenantId();
  const create = useCreateClient();
  const book = useBookingNav();
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<Client | null>(null);

  const e164 = tryToE164(phone.trim());

  // ── Live dedup: debounce the E.164 lookup while the user types. A
  // sequence guard drops stale responses (fast typing across two numbers).
  const seq = useRef(0);
  useEffect(() => {
    const mySeq = ++seq.current;
    if (!e164 || !tenantId) {
      setDuplicate(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const existing = await findClientByPhoneE164(supabase, e164, tenantId);
        if (seq.current === mySeq) setDuplicate(existing ?? null);
      } catch {
        // Network blip — the DB unique index is the ultimate guarantee.
        if (seq.current === mySeq) setDuplicate(null);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [e164, tenantId]);

  // Save-gate: phone is the primary required field (add-client design).
  const canSave = phone.trim().length > 0 && !create.isPending;

  async function handleCreate() {
    if (!canSave) return;
    setError(null);
    const trimmedPhone = phone.trim();

    // The debounce may not have fired yet (fast type → immediate Готово):
    // run the check once here unless a duplicate is already on screen —
    // while the banner is visible, Готово force-creates (web parity).
    if (e164 && !duplicate && tenantId) {
      try {
        const existing = await findClientByPhoneE164(supabase, e164, tenantId);
        if (existing) {
          setDuplicate(existing);
          return;
        }
      } catch {
        // Network blip — let the save proceed; the DB unique index is
        // the ultimate guarantee (web parity).
      }
    }

    try {
      const c = await create.mutateAsync({
        phone: trimmedPhone,
        full_name: name.trim(),
        phone_e164: e164,
      });
      // Успех → выбор следующего шага: сразу записать (частый сценарий
      // диспетчера) или открыть карточку. Обе ветки заменяют экран
      // создания карточкой, «Записать» дополнительно открывает букинг
      // (useBookingNav — календарь с ?new=1&clientId=…).
      Alert.alert("Клиент создан", name.trim() || trimmedPhone, [
        {
          text: "Записать",
          onPress: () => {
            router.replace(`/clients/${c.id}`);
            book({ clientId: c.id });
          },
        },
        {
          text: "К карточке",
          onPress: () => router.replace(`/clients/${c.id}`),
        },
      ]);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Screen edges={["top"]}>
      {/* Nav: назад + save-gated «Готово» (dimmed until phone entered) */}
      <View
        className="flex-row items-center border-b px-2 py-2"
        style={{ borderColor: t.separator }}
      >
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          accessibilityLabel="Назад к списку клиентов"
          className="h-9 flex-row items-center gap-0.5 rounded-lg pl-1 pr-2 active:opacity-60"
        >
          <ChevronLeft color={t.accent} size={22} />
          <Text className="text-[15px]" style={{ color: t.accent }}>
            Клиенты
          </Text>
        </Pressable>
        <View className="flex-1" />
        <Pressable
          onPress={handleCreate}
          disabled={!canSave}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Готово — сохранить клиента"
          accessibilityState={{ disabled: !canSave }}
          className="h-9 items-center justify-center rounded-lg px-2 active:opacity-60"
        >
          <Text
            className="text-[15px] font-semibold"
            style={{ color: canSave ? t.accent : t.faint }}
          >
            {create.isPending ? "Сохраняю…" : "Готово"}
          </Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1"
      >
        <ScrollView
          className="flex-1"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 32 }}
        >
          {/* Header = the card's header in «creating» order: phone is the
              big title, name the quiet subtitle. */}
          <Card style={{ marginHorizontal: 12, marginTop: 8, padding: 12 }}>
            <View className="flex-row items-center gap-2">
              <TextInput
                value={phone}
                // Сброс дубля на КАЖДЫЙ ввод: стейл-баннер прошлого номера
                // иначе отключал бы дедуп-проверку в handleCreate (ветка
                // «!duplicate» видела старый хит и форс-создавала дубль).
                onChangeText={(v) => {
                  setPhone(v);
                  setDuplicate(null);
                }}
                placeholder="Телефон"
                placeholderTextColor={t.placeholder}
                selectionColor={t.accent}
                keyboardAppearance={t.dark ? "dark" : "light"}
                keyboardType="phone-pad"
                autoFocus
                accessibilityLabel="Телефон клиента"
                className="min-h-[44px] flex-1 py-1 text-[22px] font-bold"
                style={{ color: t.ink }}
              />
              {e164 ? (
                <Check color={t.accent} size={20} strokeWidth={2.5} />
              ) : null}
            </View>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Имя (можно позже)"
              placeholderTextColor={t.placeholder}
              selectionColor={t.accent}
              keyboardAppearance={t.dark ? "dark" : "light"}
              accessibilityLabel="Имя клиента"
              className="min-h-[40px] py-1 text-[15px]"
              style={{ color: t.sub }}
            />

            {/* Inline dedup — «Открыть» существующего вместо дубля */}
            {duplicate ? (
              <View
                className="mt-2 border-t pt-2.5"
                style={{ borderColor: t.separator }}
              >
                <Text
                  className="pb-2 text-[11px] font-semibold uppercase tracking-wider"
                  style={{ color: t.sub }}
                >
                  Похоже, такой уже есть
                </Text>
                <View className="flex-row items-center gap-3">
                  <View className="flex-1">
                    <Text
                      className="text-sm font-semibold"
                      style={{ color: t.ink }}
                      numberOfLines={1}
                    >
                      {duplicate.full_name || duplicate.phone || "Клиент"}
                    </Text>
                    <Text className="text-xs" style={{ color: t.sub }} numberOfLines={1}>
                      {[duplicate.phone, duplicate.city].filter(Boolean).join(" · ")}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => router.replace(`/clients/${duplicate.id}`)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Открыть существующего клиента"
                    className="rounded-xl px-3.5 py-2 active:opacity-80"
                    style={{ backgroundColor: t.accent }}
                  >
                    <Text className="text-sm font-semibold" style={{ color: t.onAccent }}>
                      Открыть
                    </Text>
                  </Pressable>
                </View>
                <Text className="pt-2 text-[11px]" style={{ color: t.faint }}>
                  «Готово» всё равно создаст нового с этим номером.
                </Text>
              </View>
            ) : null}
          </Card>

          {error ? (
            <Text className="mx-4 mt-3 text-sm" style={{ color: t.danger }}>
              {error}
            </Text>
          ) : null}

          <Text className="mx-8 mt-5 text-center text-[12px] leading-4" style={{ color: t.faint }}>
            Телефон — и клиент в базе. Имя, объекты и кондиционеры добавишь
            на карточке.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
