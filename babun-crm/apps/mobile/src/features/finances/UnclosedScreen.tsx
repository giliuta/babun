import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Check, PartyPopper, XCircle } from "lucide-react-native";
import {
  getDebtAmount,
  type Appointment,
} from "@babun/shared/local/appointments";
import { formatEUR } from "@babun/shared/common/utils/money";
import {
  getCurrentCyprusTime,
  getCurrentTimeInZone,
} from "@babun/shared/common/utils/date-utils";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { useToast } from "@/components/ui/Toast";
import { useThemeColors } from "@/theme/colors";
import { formatYMD, humanDay } from "@/features/appointments/helpers";
import { useAppointments } from "@/features/calendar/queries";
import { useUpdateAppointment } from "@/features/calendar/mutations";
import { useClients } from "@/features/clients/queries";
import { buildDebtPaidPatch } from "@/features/appointments/payment";
import {
  unclosedAppointments,
  unclosedTotal,
} from "@babun/shared/local/selectors/unclosed";
import { useCalendarSettings } from "@/features/settings/local-settings";

// «Незакрытые дни» — port of web /dashboard/unclosed: past days whose
// work visits are still «Запланирован». The dispatcher works through the
// list with two quick actions per row: «Выполнена» closes the visit
// successfully, «Не состоялась» records the real reason (chips + free text)
// so the audit trail stays honest. Reachable by direct route; the
// cabinet menu entry is added separately.

const CANCEL_REASON_PRESETS = [
  "Клиент не пришёл",
  "Клиент отменил",
  "Перенесли на другой день",
  "Не смогли дозвониться",
  "Адрес недоступен",
] as const;

function daysSince(dateKey: string, todayKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  const [ty, tm, td] = todayKey.split("-").map(Number);
  const past = Date.UTC(y, (m ?? 1) - 1, d ?? 1);
  const today = Date.UTC(ty, (tm ?? 1) - 1, td ?? 1);
  return Math.max(0, Math.round((today - past) / 86_400_000));
}

function countWord(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

export function UnclosedScreen() {
  const t = useThemeColors();
  const router = useRouter();
  const toast = useToast();
  const { data: appts = [], isLoading, error } = useAppointments();
  const { data: clients = [] } = useClients();
  const { data: calendarSettings } = useCalendarSettings();
  const update = useUpdateAppointment();
  const [cancelTarget, setCancelTarget] = useState<Appointment | null>(null);
  const readBusinessToday = useCallback(
    () =>
      formatYMD(
        calendarSettings?.timezone
          ? getCurrentTimeInZone(calendarSettings.timezone)
          : getCurrentCyprusTime(),
      ),
    [calendarSettings?.timezone],
  );
  const [todayKey, setTodayKey] = useState(() =>
    formatYMD(getCurrentCyprusTime()),
  );
  useFocusEffect(
    useCallback(() => {
      setTodayKey(readBusinessToday());
    }, [readBusinessToday]),
  );

  const nameById = useMemo(
    () => new Map(clients.map((c) => [c.id, c.full_name])),
    [clients],
  );
  const clientNameOf = (a: Appointment): string =>
    (a.client_id && nameById.get(a.client_id)) || a.comment?.trim() || "—";

  // Формула жила копией в трёх экранах — теперь она одна на продукт.
  const unclosed = useMemo(
    () => unclosedAppointments(appts, todayKey),
    [appts, todayKey],
  );
  const totalAtRisk = useMemo(() => unclosedTotal(unclosed), [unclosed]);

  // Цепочка «после завершения — оплата»: визит с непогашенной суммой сразу
  // спрашивает про деньги, иначе должник появился бы молча (Финансы → Долги).
  // Способ оплаты влияет на сверку кассы, поэтому предлагаем нал/карту —
  // как секция «Оплата» в AppointmentSheet, не только наличные. Общий builder
  // пишет ledger и зеркальные колонки одним контрактом и не задваивает аванс.
  const markPaid = (apt: Appointment, debt: number, method: "cash" | "card") => {
    update.mutate(
      {
        id: apt.id,
        patch: buildDebtPaidPatch(apt, { method, amount: debt }),
      },
      {
        onSuccess: () => toast("Оплата отмечена"),
        onError: (e) => Alert.alert("Ошибка", (e as Error).message),
      },
    );
  };

  const handleComplete = (apt: Appointment) => {
    update.mutate(
      { id: apt.id, patch: { status: "completed" } },
      {
        onSuccess: () => {
          const debt = getDebtAmount(apt);
          if (debt > 0) {
            Alert.alert(
              "Закрыто как «Выполнено»",
              `Клиент оплатил ${formatEUR(debt)}?`,
              [
                {
                  text: "Оплачено наличными",
                  onPress: () => markPaid(apt, debt, "cash"),
                },
                {
                  text: "Оплачено картой",
                  onPress: () => markPaid(apt, debt, "card"),
                },
                { text: "Долг — позже", style: "cancel" },
              ],
            );
          } else {
            toast("Закрыто как «Выполнено»");
          }
        },
        onError: (e) => Alert.alert("Ошибка", (e as Error).message),
      },
    );
  };

  const handleConfirmCancel = (apt: Appointment, reason: string) => {
    const final = reason.trim() || "Не указана";
    update.mutate(
      { id: apt.id, patch: { status: "cancelled", cancel_reason: final } },
      {
        onSuccess: () => {
          toast("Визит отменён");
          setCancelTarget(null);
        },
        onError: (e) => Alert.alert("Ошибка", (e as Error).message),
      },
    );
  };

  return (
    <Screen edges={["top"]}>
      <ScreenHeader
        title={`Не закрыто${unclosed.length > 0 ? ` (${unclosed.length})` : ""}`}
      />

      {isLoading ? (
        <EmptyState state="loading" fill />
      ) : error ? (
        <EmptyState state="error" fill subtitle={(error as Error).message} />
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={unclosed}
          keyExtractor={(a) => a.id}
          contentContainerStyle={{ padding: 12, paddingBottom: 32, gap: 10 }}
          ListHeaderComponent={
            unclosed.length > 0 && totalAtRisk > 0 ? (
              <Card
                style={{
                  marginBottom: 4,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                }}
              >
                <Text className="text-[13px]" style={{ color: t.sub }}>
                  Не подтверждено:
                </Text>
                <Text
                  className="text-[15px] font-semibold tabular-nums"
                  style={{ color: t.ink }}
                >
                  {unclosed.length}{" "}
                  {countWord(unclosed.length, "запись", "записи", "записей")} на{" "}
                  {formatEUR(totalAtRisk)}
                </Text>
              </Card>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              icon={<PartyPopper color={t.success} size={32} />}
              title="Всё разобрано!"
              subtitle="Ни одной незакрытой записи. Здесь появляются визиты прошедших дней со статусом «Запланирован»."
            />
          }
          renderItem={({ item }) => (
            <UnclosedCard
              apt={item}
              todayKey={todayKey}
              clientName={clientNameOf(item)}
              busy={update.isPending}
              onComplete={() => handleComplete(item)}
              onCancel={() => setCancelTarget(item)}
              onOpenClient={() => {
                if (!item.client_id) return;
                router.push(`/clients/${item.client_id}`);
              }}
            />
          )}
        />
      )}

      <CancelReasonSheet
        apt={cancelTarget}
        clientName={cancelTarget ? clientNameOf(cancelTarget) : ""}
        busy={update.isPending}
        onClose={() => setCancelTarget(null)}
        onConfirm={(reason) => {
          if (cancelTarget) handleConfirmCancel(cancelTarget, reason);
        }}
      />
    </Screen>
  );
}

function UnclosedCard({
  apt,
  todayKey,
  clientName,
  busy,
  onComplete,
  onCancel,
  onOpenClient,
}: {
  apt: Appointment;
  todayKey: string;
  clientName: string;
  busy: boolean;
  onComplete: () => void;
  onCancel: () => void;
  onOpenClient: () => void;
}) {
  const t = useThemeColors();
  const days = daysSince(apt.date, todayKey);
  const amount = apt.total_amount ?? 0;
  return (
    <Card>
      <Pressable
        onPress={onOpenClient}
        disabled={!apt.client_id}
        accessibilityRole="button"
        accessibilityLabel={`${clientName}, открыть карточку клиента`}
        className="px-4 pb-2 pt-3 active:opacity-70"
      >
        <View className="flex-row items-start justify-between gap-3">
          <View className="min-w-0 flex-1">
            <Text
              className="text-[15px] font-semibold"
              style={{ color: t.ink }}
              numberOfLines={1}
            >
              {clientName}
            </Text>
            <Text className="mt-0.5 text-xs" style={{ color: t.sub }}>
              {humanDay(apt.date)} · {apt.time_start}
              {days > 0 ? (
                <Text style={{ color: t.warning, fontWeight: "500" }}>
                  {"  ·  "}
                  {days} {countWord(days, "день", "дня", "дней")} назад
                </Text>
              ) : null}
            </Text>
          </View>
          {amount > 0 ? (
            <Text
              className="text-[13px] font-semibold tabular-nums"
              style={{ color: t.ink }}
            >
              {formatEUR(amount)}
            </Text>
          ) : null}
        </View>
      </Pressable>

      <View
        className="flex-row"
        style={{ borderTopWidth: 1, borderTopColor: t.separator }}
      >
        <Pressable
          onPress={onComplete}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Запись выполнена"
          className="flex-1 flex-row items-center justify-center gap-1.5 active:opacity-60"
          style={{ height: 44, opacity: busy ? 0.5 : 1 }}
        >
          <Check color={t.accent} size={16} strokeWidth={2.2} />
          <Text className="text-[13px] font-medium" style={{ color: t.accent }}>
            Выполнена
          </Text>
        </Pressable>
        <View className="w-px" style={{ backgroundColor: t.separator }} />
        <Pressable
          onPress={onCancel}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Запись не состоялась"
          className="flex-1 flex-row items-center justify-center gap-1.5 active:opacity-60"
          style={{ height: 44, opacity: busy ? 0.5 : 1 }}
        >
          <XCircle color={t.danger} size={16} strokeWidth={2.2} />
          <Text className="text-[13px] font-medium" style={{ color: t.danger }}>
            Не состоялась
          </Text>
        </Pressable>
      </View>
    </Card>
  );
}

// Cancel-reason sheet (web v593): chip picker + «Другое…» free-text so
// the dispatcher records the REAL reason, not a hard-coded default.
function CancelReasonSheet({
  apt,
  clientName,
  busy,
  onClose,
  onConfirm,
}: {
  apt: Appointment | null;
  clientName: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const t = useThemeColors();
  const [picked, setPicked] = useState<string | null>(null);
  const [customText, setCustomText] = useState("");
  // Сброс по визиту: подтверждение (onConfirm) закрывает шит МИМО close(),
  // и стейл-причина прошлого клиента иначе доехала бы до следующего.
  useEffect(() => {
    setPicked(null);
    setCustomText("");
  }, [apt?.id]);
  const visible = !!apt;
  const isCustom = picked === "__custom__";
  const reasonToSubmit = isCustom ? customText.trim() : picked ?? "";
  const canSubmit = reasonToSubmit.length > 0 && !busy;

  const close = () => {
    setPicked(null);
    setCustomText("");
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1 justify-end"
        style={{ backgroundColor: t.scrim }}
      >
        <Pressable className="flex-1" onPress={close} accessible={false} />
        <View className="rounded-t-3xl p-5 pb-8" style={{ backgroundColor: t.surface }}>
          <Text className="text-lg font-bold" style={{ color: t.ink }}>
            Отменить визит
          </Text>
          {apt ? (
            <Text className="mt-1 text-[13px]" style={{ color: t.sub }}>
              {clientName} · {humanDay(apt.date)} · {apt.time_start}
            </Text>
          ) : null}

          <Text
            className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wider"
            style={{ color: t.sub }}
          >
            Причина
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {[...CANCEL_REASON_PRESETS, "__custom__"].map((r) => (
              <Chip
                key={r}
                label={r === "__custom__" ? "Другое…" : r}
                radio
                selected={picked === r}
                onPress={() => setPicked(r)}
              />
            ))}
          </View>
          {isCustom ? (
            <TextInput
              value={customText}
              onChangeText={setCustomText}
              autoFocus
              placeholder="Опишите причину"
              placeholderTextColor={t.placeholder}
              selectionColor={t.accent}
              keyboardAppearance="light"
              accessibilityLabel="Причина отмены"
              className="mt-3 rounded-[10px] px-3.5 text-[15px]"
              style={{
                height: 44,
                backgroundColor: t.fill,
                color: t.ink,
              }}
            />
          ) : null}

          <View className="mt-5 flex-row" style={{ gap: 10 }}>
            <Pressable
              onPress={close}
              accessibilityRole="button"
              accessibilityLabel="Назад"
              className="flex-1 items-center justify-center rounded-full active:opacity-60"
              style={{ height: 44, borderWidth: 1, borderColor: t.separator }}
            >
              <Text className="text-[15px] font-medium" style={{ color: t.sub }}>
                Назад
              </Text>
            </Pressable>
            <Pressable
              onPress={() => onConfirm(reasonToSubmit)}
              disabled={!canSubmit}
              accessibilityRole="button"
              accessibilityLabel="Отменить визит"
              className="flex-1 items-center justify-center rounded-full active:opacity-80"
              style={{
                height: 44,
                backgroundColor: t.danger,
                opacity: canSubmit ? 1 : 0.5,
              }}
            >
              <Text className="text-[15px] font-semibold" style={{ color: "#ffffff" }}>
                Отменить визит
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
