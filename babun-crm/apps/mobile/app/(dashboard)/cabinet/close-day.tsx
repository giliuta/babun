import { useCallback, useEffect, useMemo, useState } from "react";
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
import { useFocusEffect, useRouter } from "expo-router";
import { Check, ChevronRight } from "lucide-react-native";
import {
  getDebtAmount,
  getPaidAmount,
  type Appointment,
} from "@babun/shared/local/appointments";
import { getDayExtras, sumExtras } from "@babun/shared/local/day-extras";
import { formatEUR } from "@babun/shared/common/utils/money";
import { getStorage } from "@babun/shared/storage";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { useThemeColors } from "@/theme/colors";
import { formatYMD } from "@/features/appointments/helpers";
import { useAppointments, useDayExtras } from "@/features/calendar/queries";
import { useClients } from "@/features/clients/queries";
import { useTeams } from "@/features/reference/queries";
import { useUpdateAppointment } from "@/features/calendar/mutations";

const CLOSED_PREFIX = "babun:closed-day:";

// Persisted closure snapshot — so the «День закрыт» summary survives a reload
// (the old code stored a bare "1" and lost the cash figures).
type ClosedRecord = {
  closedAt: string;
  expectedCash: number;
  actualCash: number;
  delta: number;
};

function readClosedRecord(dayKey: string): ClosedRecord | null {
  const raw = getStorage().getRaw(`${CLOSED_PREFIX}${dayKey}`);
  if (!raw) return null;
  if (raw === "1") {
    // legacy bare flag — closed, but the cash figures weren't saved
    return { closedAt: "", expectedCash: 0, actualCash: 0, delta: 0 };
  }
  try {
    return JSON.parse(raw) as ClosedRecord;
  } catch {
    return null;
  }
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "green" | "red";
}) {
  const t = useThemeColors();
  return (
    <View className="flex-row items-center justify-between px-4 py-2">
      <Text className="text-[15px]" style={{ color: t.sub }}>
        {label}
      </Text>
      <Text
        className={`text-[15px] tabular-nums ${tone ? "font-bold" : "font-semibold"}`}
        style={{
          color:
            tone === "green" ? t.success : tone === "red" ? t.danger : t.ink,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

export default function CloseDayScreen() {
  const { data: appts = [] } = useAppointments();
  const { data: clients = [] } = useClients();
  const { data: extrasMap = {} } = useDayExtras();
  const { data: teams = [] } = useTeams();
  const update = useUpdateAppointment();
  const toast = useToast();
  const t = useThemeColors();
  const router = useRouter();

  // Recomputed on focus: the screen is used late in the evening, and left
  // open past midnight it must not silently close YESTERDAY's date.
  const [todayKey, setTodayKey] = useState(() => formatYMD(new Date()));
  useFocusEffect(
    useCallback(() => {
      setTodayKey(formatYMD(new Date()));
    }, []),
  );
  const [actualCashStr, setActualCashStr] = useState("");
  const [closedRec, setClosedRec] = useState<ClosedRecord | null>(() =>
    readClosedRecord(todayKey),
  );
  // Re-read the closure snapshot when the date rolls over.
  useEffect(() => {
    setClosedRec(readClosedRecord(todayKey));
  }, [todayKey]);
  const closed = closedRec !== null;

  const nameById = useMemo(
    () => new Map(clients.map((c) => [c.id, c.full_name])),
    [clients],
  );
  const clientName = (a: Appointment) =>
    (a.client_id && nameById.get(a.client_id)) || a.comment || "Запись";

  const { completed, inProgress, stillScheduled, unpaid, income, cash } =
    useMemo(() => {
      const day = appts.filter((a) => a.date === todayKey);
      const completed = day.filter((a) => a.status === "completed");
      const inProgress = day.filter((a) => a.status === "in_progress");
      const stillScheduled = day.filter(
        (a) => a.status === "scheduled" && a.kind === "work",
      );
      const unpaid = completed.filter((a) => getDebtAmount(a) > 0);
      // Web parity — computeFinancials (packages/shared/src/local/finance/
      // compute.ts): only completed + in_progress appointments count.
      const till = [...completed, ...inProgress];
      // «Доход» = money actually RECEIVED (prepaid + payments), not the
      // invoiced total_amount, PLUS the manual day-extras income across
      // all teams — mirrors fin.totalIncome on the web close-day page
      // (computeFinancials with dayExtrasOf=getExtrasFor) and the mobile
      // calendar footer (computeDayFinance). Extras deliberately do NOT
      // touch the expected till cash — same as compute.ts.
      const extrasIncome = teams.reduce(
        (s, team) =>
          s + sumExtras(getDayExtras(extrasMap, team.id, todayKey)).income,
        0,
      );
      const income =
        till.reduce((s, a) => s + getPaidAmount(a), 0) + extrasIncome;
      // Expected TILL cash = cash-method payments + prepaid (prepaid is
      // assumed cash, same conservative default as compute.ts). Cancelled/
      // scheduled visits never hit the till.
      const cash = till.reduce((s, a) => {
        let c = (a.payments ?? [])
          .filter((p) => p.method === "cash" && p.amount > 0)
          .reduce((ps, p) => ps + p.amount, 0);
        if ((a.prepaid_amount ?? 0) > 0) c += a.prepaid_amount;
        return s + c;
      }, 0);
      return { completed, inProgress, stillScheduled, unpaid, income, cash };
    }, [appts, todayKey, extrasMap, teams]);

  const expectedCash = cash;
  const actualCash = Math.round(Number(actualCashStr.replace(",", ".")) || 0);
  const delta = actualCash - expectedCash;

  // Следующий шаг после закрытия: бэклог прошлых дней (тот же фильтр, что
  // и в unclosed.tsx / бейдже хаба) — деньги «под вопросом» важнее всего.
  const unclosedPast = useMemo(
    () =>
      appts.filter(
        (a) =>
          (a.kind === undefined || a.kind === "work") &&
          a.status === "scheduled" &&
          a.date < todayKey,
      ).length,
    [appts, todayKey],
  );

  // Success toasts fire only from onSuccess — a failed write must not
  // pretend a money record landed (offline field use is the norm here).
  const markPaidCash = (apt: Appointment) => {
    const debt = getDebtAmount(apt);
    if (debt <= 0) return;
    // Пишем зеркальные колонки (payment_status → серверный триггер
    // дохода), иначе оплата закрытия дня не создаёт finance_transactions
    // и визит остаётся «неоплаченным» для веба. Сверка дня — про кассу,
    // поэтому способ строго наличные.
    update.mutate(
      {
        id: apt.id,
        patch: {
          payments: [
            ...(apt.payments ?? []),
            {
              id: `pay_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              method: "cash",
              amount: debt,
              paid_at: new Date().toISOString(),
            },
          ],
          payment_status: "paid",
          payment_method: "cash",
          paid_amount: getPaidAmount(apt) + debt,
        },
      },
      {
        onSuccess: () => toast("Оплата отмечена"),
        onError: (e) => Alert.alert("Ошибка", (e as Error).message),
      },
    );
  };

  const moveToTomorrow = (apt: Appointment) => {
    const next = new Date();
    next.setDate(next.getDate() + 1);
    update.mutate(
      { id: apt.id, patch: { date: formatYMD(next) } },
      {
        onSuccess: () => toast("Перенесено на завтра"),
        onError: (e) => Alert.alert("Ошибка", (e as Error).message),
      },
    );
  };

  const doCloseDay = () => {
    const rec: ClosedRecord = {
      closedAt: new Date().toISOString(),
      expectedCash,
      actualCash,
      delta,
    };
    getStorage().setRaw(`${CLOSED_PREFIX}${todayKey}`, JSON.stringify(rec));
    setClosedRec(rec);
    toast("День закрыт");
  };
  // Web parity (close-day page): closing with scheduled work left is a
  // conscious decision — confirm it instead of silently burying visits.
  const closeDay = () => {
    if (stillScheduled.length > 0) {
      Alert.alert(
        "Остались запланированные записи",
        `${stillScheduled.length} записей не выполнены. Закрыть день всё равно?`,
        [
          { text: "Отмена", style: "cancel" },
          { text: "Закрыть", onPress: doCloseDay },
        ],
      );
      return;
    }
    doCloseDay();
  };
  const reopen = () => {
    getStorage().remove(`${CLOSED_PREFIX}${todayKey}`);
    setClosedRec(null);
  };

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Закрыть день" />
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
      <ScrollView
        className="flex-1"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 32 }}
      >
        {closedRec ? (
          <View
            className="mx-3 mt-2 flex-row items-start gap-3 rounded-2xl p-4"
            style={{ backgroundColor: t.success + "1a" }}
          >
            <View
              className="h-10 w-10 items-center justify-center rounded-xl"
              style={{ backgroundColor: t.success }}
            >
              <Check color="#fff" size={22} strokeWidth={2.5} />
            </View>
            <View className="flex-1">
              <Text
                className="text-[17px] font-semibold"
                style={{ color: t.ink }}
              >
                День закрыт
              </Text>
              <Text className="mt-0.5 text-[13px]" style={{ color: t.sub }}>
                Касса {formatEUR(closedRec.actualCash)} ·{" "}
                {closedRec.delta === 0
                  ? "без расхождений"
                  : closedRec.delta > 0
                    ? `+${formatEUR(closedRec.delta)}`
                    : `${formatEUR(closedRec.delta)}`}
              </Text>
              <Pressable onPress={reopen} className="mt-2 active:opacity-70">
                <Text
                  className="text-[13px] font-semibold underline"
                  style={{ color: t.success }}
                >
                  Открыть обратно
                </Text>
              </Pressable>
              {/* следующий логичный шаг: разобрать бэклог прошлых дней */}
              {unclosedPast > 0 ? (
                <Pressable
                  onPress={() => router.push("/cabinet/unclosed")}
                  accessibilityRole="button"
                  accessibilityLabel={`Незакрытые дни, ${unclosedPast}`}
                  className="mt-3 flex-row items-center justify-between rounded-xl px-3 active:opacity-70"
                  style={{ minHeight: 44, backgroundColor: t.surface }}
                >
                  <Text
                    className="text-[14px] font-semibold"
                    style={{ color: t.ink }}
                  >
                    Разобрать незакрытые дни
                  </Text>
                  <View className="flex-row items-center gap-1">
                    <Text
                      className="text-[14px] font-bold tabular-nums"
                      style={{ color: t.warning }}
                    >
                      {unclosedPast}
                    </Text>
                    <ChevronRight color={t.chevron} size={16} />
                  </View>
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}

        <SectionCard title="Сегодня">
          <Row label="Завершено" value={String(completed.length)} />
          <Row label="В работе" value={String(inProgress.length)} />
          <Row label="Ещё запланировано" value={String(stillScheduled.length)} />
          <Row label="Доход" value={formatEUR(income)} tone="green" />
        </SectionCard>

        {!closed && (unpaid.length > 0 || stillScheduled.length > 0) ? (
          <SectionCard title="Что осталось">
            {unpaid.map((apt) => (
              <View
                key={apt.id}
                className="mx-3 my-1 flex-row items-center gap-3 rounded-xl p-2"
                style={{ backgroundColor: t.danger + "0d" }}
              >
                <View className="flex-1">
                  <Text
                    className="text-[15px] font-semibold"
                    style={{ color: t.ink }}
                    numberOfLines={1}
                  >
                    {clientName(apt)}
                  </Text>
                  <Text
                    className="text-xs tabular-nums"
                    style={{ color: t.sub }}
                  >
                    {apt.time_start} · долг {formatEUR(getDebtAmount(apt))}
                  </Text>
                </View>
                <Pressable
                  onPress={() => markPaidCash(apt)}
                  className="h-9 items-center justify-center rounded-lg px-3 active:opacity-80"
                  style={{ backgroundColor: t.success }}
                >
                  <Text
                    className="text-[13px] font-semibold"
                    style={{ color: "#fff" }}
                  >
                    Оплачено
                  </Text>
                </Pressable>
              </View>
            ))}
            {stillScheduled.map((apt) => (
              <View
                key={apt.id}
                className="mx-3 my-1 flex-row items-center gap-3 rounded-xl p-2"
                style={{ backgroundColor: t.warning + "1a" }}
              >
                <View className="flex-1">
                  <Text
                    className="text-[15px] font-semibold"
                    style={{ color: t.ink }}
                    numberOfLines={1}
                  >
                    {clientName(apt)}
                  </Text>
                  <Text
                    className="text-xs tabular-nums"
                    style={{ color: t.sub }}
                  >
                    {apt.time_start}–{apt.time_end} · ещё в плане
                  </Text>
                </View>
                <Pressable
                  onPress={() => moveToTomorrow(apt)}
                  className="h-9 items-center justify-center rounded-lg px-3 active:opacity-80"
                  style={{
                    backgroundColor: t.fill,
                  }}
                >
                  <Text
                    className="text-[13px] font-semibold"
                    style={{ color: t.sub }}
                  >
                    На завтра
                  </Text>
                </Pressable>
              </View>
            ))}
          </SectionCard>
        ) : null}

        {!closed ? (
          <SectionCard title="Касса" padded>
            <View className="flex-row items-baseline justify-between">
              <Text className="text-[15px]" style={{ color: t.sub }}>
                Должно быть
              </Text>
              <Text
                className="text-[15px] font-semibold tabular-nums"
                style={{ color: t.ink }}
              >
                {formatEUR(expectedCash)}
              </Text>
            </View>
            <Text
              className="mb-1.5 mt-3 text-[12px] font-semibold uppercase tracking-wider"
              style={{ color: t.sub }}
            >
              Сколько в кассе фактически (€)
            </Text>
            <TextInput
              value={actualCashStr}
              onChangeText={setActualCashStr}
              keyboardType="decimal-pad"
              placeholder={String(expectedCash)}
              placeholderTextColor={t.placeholder}
              selectionColor={t.accent}
              keyboardAppearance={t.dark ? "dark" : "light"}
              className="h-12 rounded-[10px] px-3.5 text-[17px] tabular-nums"
              style={{
                backgroundColor: t.fill,
                color: t.ink,
              }}
            />
            {/* Тап-чип — заполняет поле ожидаемой суммой (сознательный тап,
                не автозаполнение: пересчёт кассы должен остаться честным). */}
            <Pressable
              onPress={() => setActualCashStr(String(expectedCash))}
              accessibilityRole="button"
              accessibilityLabel={`Заполнить ожидаемой суммой ${formatEUR(expectedCash)}`}
              className="mt-2 self-start rounded-full px-3 py-1.5 active:opacity-60"
              style={{ backgroundColor: t.dark ? "rgba(90,134,255,0.16)" : "rgba(44,91,224,0.10)" }}
            >
              <Text
                className="text-[13px] font-medium tabular-nums"
                style={{ color: t.accent }}
              >
                = Должно быть {formatEUR(expectedCash)}
              </Text>
            </Pressable>
            {actualCashStr ? (
              <Text
                className="mt-2 text-[13px] font-medium tabular-nums"
                style={{ color: delta >= 0 ? t.success : t.danger }}
              >
                {delta === 0
                  ? "Касса сошлась"
                  : delta > 0
                    ? `+${formatEUR(delta)} больше ожидаемого`
                    : `Не хватает ${formatEUR(Math.abs(delta))}`}
              </Text>
            ) : null}
            <View className="mt-4">
              <Button label="Закрыть день" onPress={closeDay} disabled={!actualCashStr} />
            </View>
            {!actualCashStr ? (
              <Text
                className="mt-2 text-center text-[13px]"
                style={{ color: t.faint }}
              >
                Введите фактическую сумму в кассе
              </Text>
            ) : null}
          </SectionCard>
        ) : null}
      </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
