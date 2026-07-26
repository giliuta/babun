import { useMemo, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Text as NativeText,
  TextInput as NativeTextInput,
  View,
  type TextInputProps,
  type TextProps,
} from "react-native";
import { Check, Search, UserRound, X } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Client } from "@babun/shared/local/clients";
import { findClientByPhoneE164 } from "@babun/shared/db/repositories/clients";
import { formatEUR } from "@babun/shared/common/utils/money";

import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { ICON } from "@/components/ui/tokens";
import { Screen } from "@/components/ui/Screen";
import { SectionCard } from "@/components/ui/SectionCard";
import { useThemeColors } from "@/theme/colors";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { useCreateClient } from "@/features/clients/queries";
import type { Service } from "@/features/services/queries";
import {
  buildQuickClientDraft,
  findQuickClientDuplicate,
} from "@/features/appointments/booking-prefill";
import { useReduceMotion } from "@/lib/reduce-motion";

function Text({ maxFontSizeMultiplier = 1.3, ...props }: TextProps) {
  return (
    <NativeText maxFontSizeMultiplier={maxFontSizeMultiplier} {...props} />
  );
}


function TextInput({
  maxFontSizeMultiplier = 1.3,
  ...props
}: TextInputProps) {
  return (
    <NativeTextInput
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      {...props}
    />
  );
}

const durationLabel = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0
    ? rest > 0
      ? `${hours} ч ${rest} мин`
      : `${hours} ч`
    : `${rest} мин`;
};

export function ClientPicker({
  visible,
  onClose,
  clients,
  recentIds,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  clients: Client[];
  recentIds: string[];
  onPick: (client: Client) => void;
}) {
  const t = useThemeColors();
  const insets = useSafeAreaInsets();
  const reduced = useReduceMotion();
  const tenantId = useTenantId();
  const [q, setQ] = useState("");
  const createClient = useCreateClient();

  const digits = q.replace(/\D/g, "");
  const quickDraft = useMemo(() => buildQuickClientDraft(q), [q]);
  const duplicate = useMemo(
    () => findQuickClientDuplicate(clients, quickDraft.phone_e164),
    [clients, quickDraft.phone_e164],
  );
  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) {
      const byId = new Map(clients.map((c) => [c.id, c]));
      return recentIds.map((id) => byId.get(id)).filter(Boolean) as Client[];
    }
    return clients.filter(
      (c) =>
        (c.full_name || "").toLowerCase().includes(query) ||
        (digits.length > 0 &&
          (c.phone || "").replace(/\D/g, "").includes(digits)),
    );
  }, [q, clients, recentIds, digits]);

  const create = async () => {
    if (!quickDraft.canCreate || createClient.isPending) return;
    if (duplicate) {
      onPick(duplicate);
      setQ("");
      return;
    }
    try {
      // Кэш может быть холодным/устаревшим: перед реальным insert повторяем
      // серверный guard тем же repository helper, что экран создания клиента.
      if (quickDraft.phone_e164 && tenantId) {
        try {
          const existing = await findClientByPhoneE164(
            supabase,
            quickDraft.phone_e164,
            tenantId,
          );
          if (existing) {
            onPick(existing);
            setQ("");
            return;
          }
        } catch {
          // Offline-first create остаётся доступным; кэш-гвард уже отработал,
          // а серверную гонку окончательно разрешит sync/replay.
        }
      }
      const c = await createClient.mutateAsync({
        full_name: quickDraft.full_name,
        phone: quickDraft.phone,
        phone_e164: quickDraft.phone_e164,
      });
      onPick(c);
      setQ("");
    } catch (e) {
      Alert.alert("Ошибка", (e as Error).message);
    }
  };

  return (
    <Modal visible={visible} animationType={reduced ? "none" : "slide"} onRequestClose={onClose}>
      <Screen edges={["top"]}>
        <View
          className="flex-row items-center px-3"
          style={{ height: 48, borderBottomWidth: 1, borderBottomColor: t.separator }}
        >
          <Pressable
            onPress={onClose}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Закрыть выбор клиента"
            style={{ minWidth: 72, minHeight: 44, justifyContent: "center" }}
          >
            <Text style={{ fontSize: 16, color: t.body }}>Отмена</Text>
          </Pressable>
          <Text className="flex-1 text-center" style={{ fontSize: 16, fontWeight: "600", color: t.ink }}>
            Клиент
          </Text>
          <View style={{ minWidth: 72 }} />
        </View>

        <View
          className="mx-3 mt-3 flex-row items-center gap-2 rounded-[12px] px-3"
          style={{ height: 44, backgroundColor: t.fill }}
        >
          <Search color={t.placeholder} size={ICON.sm} />
        <TextInput
          keyboardAppearance="light"
          accessibilityLabel="Поиск клиента"
            value={q}
            onChangeText={setQ}
            placeholder="Имя или телефон"
            placeholderTextColor={t.placeholder}
            keyboardType="default"
            style={{ flex: 1, fontSize: 16, color: t.ink }}
          />
          {q ? (
            <Pressable
              onPress={() => setQ("")}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Очистить поиск"
              style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
            >
              <X color={t.placeholder} size={ICON.sm} />
            </Pressable>
          ) : null}
        </View>

        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
        >
          {!q ? (
            <Text
              className="px-5 pb-1.5 pt-4"
              style={{ fontSize: 12, fontWeight: "700", color: t.faint, letterSpacing: 0.4 }}
            >
              НЕДАВНИЕ
            </Text>
          ) : null}
          <SectionCard>
            {filtered.length > 0 ? (
              filtered.map((c, i) => (
                <Pressable
                  key={c.id}
                  onPress={() => onPick(c)}
                  className="flex-row items-center px-4 py-3"
                  style={i > 0 ? { borderTopWidth: 1, borderTopColor: t.separator } : undefined}
                  accessibilityRole="button"
                  accessibilityLabel={`${c.full_name || "Без имени"}${c.phone ? `, ${c.phone}` : ""}`}
                >
                  <View
                    className="mr-3 items-center justify-center rounded-full"
                    style={{ width: 38, height: 38, backgroundColor: `${t.accent}14` }}
                  >
                    <Text style={{ fontSize: 15, fontWeight: "700", color: t.accent }}>
                      {(c.full_name || "?").slice(0, 1).toUpperCase()}
                    </Text>
                  </View>
                  <View className="flex-1">
                    <Text style={{ fontSize: 15, fontWeight: "500", color: t.ink }}>
                      {c.full_name || "Без имени"}
                    </Text>
                    {c.phone ? (
                      <Text style={{ fontSize: 13, color: t.sub, marginTop: 2 }}>{c.phone}</Text>
                    ) : null}
                  </View>
                </Pressable>
              ))
            ) : (
              <EmptyState
                title={q.trim() ? "Клиенты не найдены" : "Недавних клиентов пока нет"}
                subtitle={
                  q.trim()
                    ? "Проверьте запрос или создайте клиента по введённым данным."
                    : "Введите имя или телефон в строке поиска."
                }
              />
            )}
          </SectionCard>

          {q.trim() && quickDraft.canCreate ? (
            <Pressable
              onPress={create}
              disabled={createClient.isPending}
              className="mx-3 mt-2 flex-row items-center gap-3 rounded-[14px] px-4 py-3.5"
              style={{
                backgroundColor: `${t.accent}0d`,
                opacity: createClient.isPending ? 0.55 : 1,
              }}
              accessibilityRole="button"
              accessibilityState={{ disabled: createClient.isPending }}
              accessibilityLabel={
                duplicate
                  ? `Выбрать существующего клиента ${duplicate.full_name || duplicate.phone || q.trim()}`
                  : `Создать клиента ${q.trim()}`
              }
            >
              <View
                className="items-center justify-center rounded-full"
                style={{ width: 26, height: 26, backgroundColor: `${t.accent}1a` }}
              >
                <UserRound color={t.accent} size={ICON.xs} />
              </View>
              <Text style={{ fontSize: 15, fontWeight: "600", color: t.accent }}>
                {createClient.isPending
                  ? "Создаём клиента…"
                  : duplicate
                  ? `Выбрать существующего «${
                      duplicate.full_name || duplicate.phone || q.trim()
                    }»`
                  : `Создать клиента «${q.trim()}»`}
              </Text>
            </Pressable>
          ) : q.trim() && quickDraft.kind === "phone" ? (
            <Text className="px-5 pt-3" style={{ fontSize: 13, color: t.sub }}>
              Введите полный номер телефона
            </Text>
          ) : null}
        </ScrollView>
      </Screen>
    </Modal>
  );
}

export function ServicePicker({
  visible,
  onClose,
  services,
  frequent,
  selectedIds,
  onToggle,
}: {
  visible: boolean;
  onClose: () => void;
  services: Service[];
  frequent: Service[];
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  const t = useThemeColors();
  const insets = useSafeAreaInsets();
  const reduced = useReduceMotion();
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return query ? services.filter((s) => s.name.toLowerCase().includes(query)) : services;
  }, [q, services]);
  // Живой счётчик выбранного — чтобы не закрывать модалку ради проверки.
  const subtotal = useMemo(
    () =>
      selectedIds.reduce(
        (sum, id) => sum + (services.find((s) => s.id === id)?.price ?? 0),
        0,
      ),
    [selectedIds, services],
  );

  return (
    <Modal visible={visible} animationType={reduced ? "none" : "slide"} onRequestClose={onClose}>
      <Screen edges={["top"]}>
        <View
          className="flex-row items-center px-3"
          style={{ height: 48, borderBottomWidth: 1, borderBottomColor: t.separator }}
        >
          <View style={{ minWidth: 72 }} />
          <Text className="flex-1 text-center" style={{ fontSize: 16, fontWeight: "600", color: t.ink }}>
            Услуги
          </Text>
          <Pressable
            onPress={onClose}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Закрыть выбор услуг"
            style={{ minWidth: 72, minHeight: 44, alignItems: "flex-end", justifyContent: "center" }}
          >
            <Text style={{ fontSize: 16, fontWeight: "600", color: t.accent }}>Готово</Text>
          </Pressable>
        </View>

        <View
          className="mx-3 mt-3 flex-row items-center gap-2 rounded-[12px] px-3"
          style={{ height: 44, backgroundColor: t.fill }}
        >
          <Search color={t.placeholder} size={ICON.sm} />
        <TextInput
          keyboardAppearance="light"
          accessibilityLabel="Поиск услуги"
            value={q}
            onChangeText={setQ}
            placeholder="Название услуги"
            placeholderTextColor={t.placeholder}
            style={{ flex: 1, fontSize: 16, color: t.ink }}
          />
        </View>

        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
        >
          {!q && frequent.length > 0 ? (
            <>
              <Text
                className="px-5 pb-1.5 pt-4"
                style={{ fontSize: 12, fontWeight: "700", color: t.faint, letterSpacing: 0.4 }}
              >
                ЧАСТЫЕ
              </Text>
              <View className="flex-row flex-wrap gap-2 px-4 pb-2">
                {frequent.map((s) => (
                  <Chip
                    key={s.id}
                    label={s.name}
                    variant="tint"
                    selected={selectedIds.includes(s.id)}
                    onPress={() => onToggle(s.id)}
                  />
                ))}
              </View>
            </>
          ) : null}
          <SectionCard>
            {filtered.length > 0 ? (
              filtered.map((s, i) => {
                const on = selectedIds.includes(s.id);
                return (
                  <Pressable
                    key={s.id}
                    onPress={() => onToggle(s.id)}
                    className="flex-row items-center px-4 py-3"
                    style={i > 0 ? { borderTopWidth: 1, borderTopColor: t.separator } : undefined}
                    accessibilityRole="checkbox"
                    accessibilityLabel={`${s.name}, ${formatEUR(s.price)}`}
                    accessibilityState={{ checked: selectedIds.includes(s.id) }}
                  >
                    <View className="flex-1">
                      <Text style={{ fontSize: 15, color: t.ink }}>{s.name}</Text>
                      <Text style={{ fontSize: 13, color: t.placeholder, marginTop: 1 }}>
                        {formatEUR(s.price)} · {durationLabel(s.duration_minutes)}
                      </Text>
                    </View>
                    {on ? <Check color={t.accent} size={ICON.md} /> : null}
                  </Pressable>
                );
              })
            ) : (
              <EmptyState
                title={q.trim() ? "Услуги не найдены" : "Нет доступных услуг"}
                subtitle={
                  q.trim()
                    ? "Измените запрос и попробуйте ещё раз."
                    : "Для выбранной бригады пока не настроены услуги."
                }
              />
            )}
          </SectionCard>
        </ScrollView>

        {selectedIds.length > 0 ? (
          <View
            style={{
              paddingHorizontal: 14,
              paddingTop: 8,
              paddingBottom: insets.bottom + 8,
              backgroundColor: t.canvas,
              borderTopWidth: 1,
              borderTopColor: t.separator,
            }}
          >
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={`Готово, выбрано услуг: ${selectedIds.length} на ${formatEUR(subtotal)}`}
              className="items-center justify-center rounded-full"
              style={{ minHeight: 50, backgroundColor: t.accent }}
            >
              <Text style={{ fontSize: 16, fontWeight: "700", color: t.onAccent, fontVariant: ["tabular-nums"] }}>
                Готово · {selectedIds.length} · {formatEUR(subtotal)}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </Screen>
    </Modal>
  );
}
