import { useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Linking,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { Check, Phone, Plus, Search, X } from "lucide-react-native";
import type { RecurringReminder } from "@babun/shared/local/recurring";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Divider } from "@/components/ui/Divider";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { useToast } from "@/components/ui/Toast";
import { formatYMD, humanDay, parseYMD } from "@/features/appointments/helpers";
import { useClients } from "@/features/clients/queries";
import {
  useCreateReminder,
  useDeleteReminder,
  useRecurringReminders,
  useUpdateReminderStatus,
} from "@/features/recurring/queries";

function dueTone(
  next: string,
  t: ReturnType<typeof useThemeColors>,
): { label: string; color: string; bg: string } {
  const today = formatYMD(new Date());
  if (next <= today)
    return { label: "Пора", color: t.danger, bg: t.danger + "1a" };
  // parseYMD = local midnight; `new Date("YYYY-MM-DD")` would parse as
  // UTC and shift the 14-day threshold by a few hours east of UTC.
  const d = parseYMD(next).getTime() - Date.now();
  if (d <= 14 * 86400000)
    return { label: "Скоро", color: t.warning, bg: t.warning + "26" };
  return {
    label: humanDay(next),
    color: t.sub,
    bg: t.dark ? "rgba(255,255,255,0.07)" : "#eef1f5",
  };
}

export default function RecurringScreen() {
  const { data: reminders = [], isLoading } = useRecurringReminders();
  const { data: clients = [] } = useClients();
  const create = useCreateReminder();
  const setStatus = useUpdateReminderStatus();
  const del = useDeleteReminder();
  const toast = useToast();
  const t = useThemeColors();

  const pending = useMemo(
    () => reminders.filter((r) => r.status === "pending"),
    [reminders],
  );

  const [open, setOpen] = useState(false);
  const [clientId, setClientId] = useState<string | null>(null);
  const [summary, setSummary] = useState("");
  const [months, setMonths] = useState(6);
  const [q, setQ] = useState("");

  const client = clients.find((c) => c.id === clientId) ?? null;
  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return (
      query
        ? clients.filter(
            (c) =>
              c.full_name.toLowerCase().includes(query) ||
              (c.phone ?? "").includes(query),
          )
        : clients
    ).slice(0, 50);
  }, [clients, q]);

  const reset = () => {
    setClientId(null);
    setSummary("");
    setMonths(6);
    setQ("");
  };

  const submit = async () => {
    if (!client) return;
    try {
      await create.mutateAsync({
        client_id: client.id,
        client_name: client.full_name,
        phone: client.phone ?? "",
        team_id: null,
        service_ids: [],
        service_summary: summary.trim() || "Повторное ТО",
        last_date: formatYMD(new Date()),
        interval_months: months,
        note: "",
        manual: true,
      });
      setOpen(false);
      reset();
      toast("Напоминание создано");
    } catch (e) {
      // Sheet stays open — retry without re-picking the client.
      Alert.alert("Ошибка", (e as Error).message);
    }
  };

  // Web parity (recurring/page.tsx): hard delete goes through a confirm.
  const confirmDelete = (item: RecurringReminder) =>
    Alert.alert("Удалить напоминание?", item.client_name, [
      { text: "Отмена", style: "cancel" },
      {
        text: "Удалить",
        style: "destructive",
        onPress: () =>
          del.mutate(item.id, {
            onError: (e) => Alert.alert("Ошибка", e.message),
          }),
      },
    ]);

  return (
    <Screen edges={["top"]}>
      <ScreenHeader
        title="Повторяющиеся ТО"
        subtitle={pending.length ? `${pending.length} в работе` : undefined}
        right={
          <Pressable
            onPress={() => setOpen(true)}
            hitSlop={8}
            className="h-10 w-10 items-center justify-center rounded-full active:opacity-60"
          >
            <Plus color={t.accent} size={ICON.md} />
          </Pressable>
        }
      />
      {isLoading ? (
        <EmptyState state="loading" fill />
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={pending}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ flexGrow: 1, paddingTop: 8 }}
          renderItem={({ item }) => {
            const tone = dueTone(item.next_due_date, t);
            return (
              <View className="flex-row items-center px-4 py-3">
                <View className="flex-1 pr-2">
                  <Text className="text-base font-semibold" style={{ color: t.ink }} numberOfLines={1}>
                    {item.client_name}
                  </Text>
                  <Text className="text-sm" style={{ color: t.sub }} numberOfLines={1}>
                    {item.service_summary}
                  </Text>
                  <Text
                    className="mt-1 self-start overflow-hidden rounded-full px-2 py-0.5 text-[11px] font-semibold"
                    style={{ color: tone.color, backgroundColor: tone.bg }}
                  >
                    {tone.label}
                  </Text>
                </View>
                {item.phone ? (
                  <Pressable
                    onPress={() => Linking.openURL(`tel:${item.phone}`)}
                    className="mr-1 h-9 w-9 items-center justify-center rounded-full"
                    style={{ backgroundColor: t.success + "1a" }}
                  >
                    <Phone color={t.success} size={ICON.sm} />
                  </Pressable>
                ) : null}
                <Pressable
                  onPress={() =>
                    setStatus.mutate(
                      { id: item.id, status: "booked" },
                      {
                        onSuccess: () => toast("Отмечено записанным"),
                        onError: (e) => Alert.alert("Ошибка", e.message),
                      },
                    )
                  }
                  className="mr-1 h-9 w-9 items-center justify-center rounded-full"
                  style={{ backgroundColor: t.accent + "1a" }}
                >
                  <Check color={t.accent} size={ICON.sm} />
                </Pressable>
                <Pressable
                  onPress={() => confirmDelete(item)}
                  className="h-9 w-9 items-center justify-center rounded-full active:opacity-60"
                >
                  <X color={t.faint} size={ICON.sm} />
                </Pressable>
              </View>
            );
          }}
          ItemSeparatorComponent={() => <Divider inset={16} />}
          ListEmptyComponent={
            <EmptyState
              fill
              title="Нет напоминаний"
              subtitle="«Через 6 мес — чистка» и т.п. Добавьте через +"
            />
          }
        />
      )}

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable className="flex-1" style={{ backgroundColor: t.scrim }} onPress={() => setOpen(false)} />
        <View
          className="absolute bottom-0 left-0 right-0 h-[80%] rounded-t-3xl p-5 pb-8"
          style={{ backgroundColor: t.surface }}
        >
          <Text className="mb-3 text-lg font-bold" style={{ color: t.ink }}>Напоминание</Text>
          {!client ? (
            <>
              <View
                className="mb-2 flex-row items-center gap-2 rounded-xl px-3"
                style={{ backgroundColor: t.dark ? "rgba(255,255,255,0.07)" : "#eef1f5" }}
              >
                <Search color={t.faint} size={ICON.sm} />
                <TextInput
                  value={q}
                  onChangeText={setQ}
                  placeholder="Клиент"
                  placeholderTextColor={t.placeholder}
                  selectionColor={t.accent}
                  keyboardAppearance={t.dark ? "dark" : "light"}
                  className="flex-1 py-2.5 text-base"
                  style={{ color: t.ink }}
                />
              </View>
              <FlatList
                data={filtered}
                keyExtractor={(c) => c.id}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => (
                  <Pressable
                    onPress={() => setClientId(item.id)}
                    className="px-1 py-3 active:opacity-70"
                  >
                    <Text className="text-base" style={{ color: t.ink }}>{item.full_name}</Text>
                    {item.phone ? (
                      <Text className="text-sm" style={{ color: t.sub }}>{item.phone}</Text>
                    ) : null}
                  </Pressable>
                )}
                ItemSeparatorComponent={() => <Divider />}
              />
            </>
          ) : (
            <>
              <Pressable
                onPress={() => setClientId(null)}
                className="mb-2 flex-row items-center justify-between rounded-xl px-3 py-2.5"
                style={{ backgroundColor: t.canvas }}
              >
                <Text className="text-base font-semibold" style={{ color: t.ink }}>
                  {client.full_name}
                </Text>
                <Text className="text-sm" style={{ color: t.accent }}>Изменить</Text>
              </Pressable>
              <Field label="Что напомнить" value={summary} onChangeText={setSummary} placeholder="Чистка 2 шт" />
              <Text className="mb-2 text-xs font-medium" style={{ color: t.sub }}>Через</Text>
              <View className="mb-4 flex-row gap-2">
                {[3, 6, 12].map((m) => (
                  <Pressable
                    key={m}
                    onPress={() => setMonths(m)}
                    className="flex-1 items-center rounded-xl py-2.5"
                    style={{
                      backgroundColor:
                        months === m
                          ? t.accent
                          : t.dark
                            ? "rgba(255,255,255,0.07)"
                            : "#eef1f5",
                    }}
                  >
                    <Text
                      className="text-sm font-semibold"
                      style={{ color: months === m ? t.onAccent : t.sub }}
                    >
                      {m} мес
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Button label="Создать" onPress={submit} disabled={create.isPending} loading={create.isPending} />
            </>
          )}
        </View>
      </Modal>
    </Screen>
  );
}
