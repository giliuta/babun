import { useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useRouter } from "expo-router";
import { Check, Phone, Search, X } from "lucide-react-native";
import {
  addMonthsYYYYMMDD,
  dueReminders,
  type RecurringReminder,
} from "@babun/shared/local/recurring";
import { formatDateLongRu } from "@babun/shared/common/utils/date-utils";
import { Screen } from "@/components/ui/Screen";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { AddRow } from "@/components/ui/AddRow";
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

// Повторяющиеся ТО — инбокс возвратов (web /dashboard/recurring):
//  * «Пора» = next_due_date в пределах 14 дней или просрочено (dueReminders);
//  * «Будущие» скрыты за «Показать ещё N на потом»;
//  * «Записать» ведёт в букинг с предзаполненным клиентом/командой;
//  * ручное создание — с выбором даты ПОСЛЕДНЕГО ТО + интервала, чтобы
//    next_due = last + interval (авто-посев из завершённой записи делает
//    AppointmentSheet — см. RepeatReminderSheet в features/recurring).

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
    bg: t.fill,
  };
}

type ListRow =
  | { kind: "header"; id: string; title: string }
  | { kind: "item"; id: string; item: RecurringReminder }
  | { kind: "more"; id: string; count: number };

export default function RecurringScreen() {
  const { data: reminders = [], isLoading, isError, refetch } = useRecurringReminders();
  const { data: clients = [] } = useClients();
  const create = useCreateReminder();
  const setStatus = useUpdateReminderStatus();
  const del = useDeleteReminder();
  const toast = useToast();
  const t = useThemeColors();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);

  // Пора / будущие (web parity: dueReminders = просрочено или ≤ 14 дней).
  const due = useMemo(() => dueReminders(reminders), [reminders]);
  const future = useMemo(
    () =>
      reminders
        .filter((r) => r.status === "pending" && !due.includes(r))
        .sort((a, b) => a.next_due_date.localeCompare(b.next_due_date)),
    [reminders, due],
  );
  const totalPending = due.length + future.length;

  const rows = useMemo<ListRow[]>(() => {
    const out: ListRow[] = [];
    if (due.length > 0) {
      out.push({ kind: "header", id: "h-due", title: "Пора" });
      for (const r of due) out.push({ kind: "item", id: r.id, item: r });
    }
    if (future.length > 0) {
      if (showAll) {
        out.push({ kind: "header", id: "h-future", title: "Будущие" });
        for (const r of future) out.push({ kind: "item", id: r.id, item: r });
      } else {
        out.push({ kind: "more", id: "more", count: future.length });
      }
    }
    return out;
  }, [due, future, showAll]);

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

  // «Записать» — в календарь с предзаполненным клиентом/командой (веб шлёт
  // ?new=1&client_id=…; мобильный обработчик в (dashboard)/index.tsx читает
  // new/clientId/locationId/teamId).
  const book = (item: RecurringReminder) =>
    router.push({
      pathname: "/",
      params: {
        new: "1",
        // Пустые значения не передаём: обработчик читает `?? null`, а пустая
        // строка выглядела бы как «клиент с id ""».
        ...(item.client_id ? { clientId: item.client_id } : {}),
        ...(item.team_id ? { teamId: item.team_id } : {}),
      },
    });

  const renderReminder = (item: RecurringReminder) => {
    const tone = dueTone(item.next_due_date, t);
    return (
      <View className="px-4 py-3">
        <View className="flex-row items-center">
          <View className="flex-1 pr-2">
            <Text
              className="text-base font-semibold"
              style={{ color: t.ink }}
              numberOfLines={1}
            >
              {item.client_name}
            </Text>
            {item.service_summary ? (
              <Text className="text-sm" style={{ color: t.sub }} numberOfLines={1}>
                {item.service_summary}
              </Text>
            ) : null}
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
              hitSlop={4}
              accessibilityRole="button"
              accessibilityLabel={`Позвонить: ${item.client_name}`}
              className="mr-1 h-11 w-11 items-center justify-center rounded-full"
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
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel="Отметить записанным"
            className="mr-1 h-11 w-11 items-center justify-center rounded-full"
            style={{ backgroundColor: t.accent + "1a" }}
          >
            <Check color={t.accent} size={ICON.sm} />
          </Pressable>
          <Pressable
            onPress={() => confirmDelete(item)}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel="Удалить напоминание"
            className="h-11 w-11 items-center justify-center rounded-full active:opacity-60"
          >
            <X color={t.faint} size={ICON.sm} />
          </Pressable>
        </View>
        <Pressable
          onPress={() => book(item)}
          accessibilityRole="button"
          accessibilityLabel={`Записать: ${item.client_name}`}
          className="mt-2 items-center rounded-xl py-2.5 active:opacity-80"
          style={{ backgroundColor: t.accent }}
        >
          <Text className="text-sm font-semibold" style={{ color: t.onAccent }}>
            Записать
          </Text>
        </Pressable>
      </View>
    );
  };

  return (
    <Screen edges={["top"]}>
      <ScreenHeader
        title="Повторяющиеся ТО"
        subtitle={
          totalPending
            ? due.length
              ? `${due.length} пора · ${future.length} на потом`
              : `${future.length} на потом`
            : undefined
        }
      />
      {isLoading ? (
        <EmptyState state="loading" fill />
      ) : isError ? (
        <EmptyState
          fill
          state="error"
          title="Не удалось загрузить напоминания"
          action={{ label: "Повторить", onPress: () => void refetch() }}
        />
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={rows}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ flexGrow: 1, paddingTop: 8, paddingBottom: 24 }}
          renderItem={({ item: row }) => {
            if (row.kind === "header") {
              return (
                <Text
                  className="px-4 pb-1 pt-3 text-[11px] font-bold uppercase tracking-wider"
                  style={{ color: t.faint }}
                >
                  {row.title}
                </Text>
              );
            }
            if (row.kind === "more") {
              return (
                <Pressable
                  onPress={() => setShowAll(true)}
                  accessibilityRole="button"
                  accessibilityLabel={`Показать ещё ${row.count} на потом`}
                  className="mx-4 mt-2 items-center rounded-xl border border-dashed py-3 active:opacity-60"
                  style={{ borderColor: t.separator }}
                >
                  <Text className="text-sm font-medium" style={{ color: t.sub }}>
                    Показать ещё {row.count} на потом
                  </Text>
                </Pressable>
              );
            }
            return renderReminder(row.item);
          }}
          ItemSeparatorComponent={() => <Divider inset={16} />}
          ListFooterComponent={
            reminders.length > 0 ? (
              <>
                <Divider inset={16} />
                <AddRow label="Добавить напоминание" onPress={() => setOpen(true)} />
              </>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              fill
              title="Нет повторных напоминаний"
              subtitle="После выполненной записи «Повторить через…» создаст карточку — мы сами подскажем, когда звонить. Или добавьте вручную."
              action={{ label: "Добавить напоминание", onPress: () => setOpen(true) }}
            />
          }
        />
      )}

      <NewReminderSheet
        open={open}
        clients={clients}
        busy={create.isPending}
        onClose={() => setOpen(false)}
        onSubmit={async (input) => {
          try {
            await create.mutateAsync(input);
            setOpen(false);
            toast("Напоминание создано");
            return true;
          } catch (e) {
            // Шит остаётся открытым — ввод не теряется.
            Alert.alert("Ошибка", e instanceof Error ? e.message : "Не удалось сохранить");
            return false;
          }
        }}
      />
    </Screen>
  );
}

// ─── Ручное создание: клиент → что напомнить → последнее ТО + интервал ──
function NewReminderSheet({
  open,
  clients,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  clients: { id: string; full_name: string; phone: string | null }[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (input: {
    client_id: string;
    client_name: string;
    phone: string;
    team_id: null;
    service_ids: string[];
    service_summary: string;
    last_date: string;
    interval_months: number;
    note: string;
    manual: true;
  }) => Promise<boolean>;
}) {
  const t = useThemeColors();
  const [clientId, setClientId] = useState<string | null>(null);
  const [summary, setSummary] = useState("");
  const [months, setMonths] = useState(6);
  const [lastDate, setLastDate] = useState(() => formatYMD(new Date()));
  const [q, setQ] = useState("");
  const [wasOpen, setWasOpen] = useState(false);

  if (open !== wasOpen) {
    // Сброс черновика на каждое открытие (render-time reset).
    setWasOpen(open);
    if (open) {
      setClientId(null);
      setSummary("");
      setMonths(6);
      setLastDate(formatYMD(new Date()));
      setQ("");
    }
  }

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

  const nextDue = addMonthsYYYYMMDD(lastDate, months);

  const submit = async () => {
    if (!client) return;
    await onSubmit({
      client_id: client.id,
      client_name: client.full_name,
      phone: client.phone ?? "",
      team_id: null,
      service_ids: [],
      service_summary: summary.trim() || "Повторное ТО",
      last_date: lastDate,
      interval_months: months,
      note: "",
      manual: true,
    });
  };

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable
          className="flex-1"
          style={{ backgroundColor: t.scrim }}
          onPress={onClose}
          accessibilityLabel="Закрыть"
        />
        <View
          className="h-[80%] rounded-t-3xl p-5 pb-8"
          style={{ backgroundColor: t.surface }}
        >
          <Text className="mb-3 text-lg font-bold" style={{ color: t.ink }}>
            Напоминание
          </Text>
          {!client ? (
            <>
              <View
                className="mb-2 flex-row items-center gap-2 rounded-xl px-3"
                style={{ backgroundColor: t.fill }}
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
                  accessibilityLabel="Поиск клиента"
                />
              </View>
              <FlatList
                data={filtered}
                keyExtractor={(c) => c.id}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => (
                  <Pressable
                    onPress={() => setClientId(item.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Выбрать клиента ${item.full_name}`}
                    className="px-1 py-3 active:opacity-70"
                  >
                    <Text className="text-base" style={{ color: t.ink }}>
                      {item.full_name}
                    </Text>
                    {item.phone ? (
                      <Text className="text-sm" style={{ color: t.sub }}>
                        {item.phone}
                      </Text>
                    ) : null}
                  </Pressable>
                )}
                ItemSeparatorComponent={() => <Divider />}
                ListEmptyComponent={
                  <EmptyState title="Никого не нашли" subtitle="Измените запрос" />
                }
              />
            </>
          ) : (
            <>
              <Pressable
                onPress={() => setClientId(null)}
                accessibilityRole="button"
                accessibilityLabel="Сменить клиента"
                className="mb-2 flex-row items-center justify-between rounded-xl px-3 py-2.5"
                style={{ backgroundColor: t.canvas }}
              >
                <Text className="text-base font-semibold" style={{ color: t.ink }}>
                  {client.full_name}
                </Text>
                <Text className="text-sm" style={{ color: t.accent }}>
                  Изменить
                </Text>
              </Pressable>
              <Field
                label="Что напомнить"
                value={summary}
                onChangeText={setSummary}
                placeholder="Чистка 2 шт"
              />
              <View className="mb-3 flex-row items-center justify-between">
                <Text className="text-xs font-medium" style={{ color: t.sub }}>
                  Последнее ТО
                </Text>
                <DateTimePicker
                  value={parseYMD(lastDate)}
                  mode="date"
                  display="compact"
                  maximumDate={new Date()}
                  onChange={(_, d) => d && setLastDate(formatYMD(d))}
                />
              </View>
              <Text className="mb-2 text-xs font-medium" style={{ color: t.sub }}>
                Через
              </Text>
              <SegmentedControl
                options={[
                  { value: "3", label: "3 мес" },
                  { value: "6", label: "6 мес" },
                  { value: "12", label: "12 мес" },
                ]}
                value={String(months) as "3" | "6" | "12"}
                onChange={(v) => setMonths(Number(v))}
                style={{ marginBottom: 8 }}
              />
              <Text className="mb-4 text-center text-sm" style={{ color: t.sub }}>
                Напомним{" "}
                <Text style={{ fontWeight: "600", color: t.ink }}>
                  {formatDateLongRu(nextDue)}
                </Text>
              </Text>
              <Button
                label="Создать"
                onPress={() => void submit()}
                disabled={busy}
                loading={busy}
              />
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
