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
import { formatEURExact as formatEUR } from "@babun/shared/common/utils/money";
import {
  getCurrentCyprusTime,
  getCurrentTimeInZone,
} from "@babun/shared/common/utils/date-utils";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { useToast } from "@/components/ui/Toast";
import { useThemeColors } from "@/theme/colors";
import { formatYMD, parseYMD } from "@/features/appointments/helpers";
import { useAppointments, useDayExtras } from "@/features/calendar/queries";
import { useClients } from "@/features/clients/queries";
import { useTeams } from "@/features/reference/queries";
import { useUpdateAppointment } from "@/features/calendar/mutations";
import { buildDebtPaidPatch } from "@/features/appointments/payment";
import {
  cashCentsToInput,
  parseCashInputToCents,
  useCloseDay,
  useDayClosure,
  useReopenDay,
} from "@/features/settings/day-closures";
import { useCalendarSettings } from "@/features/settings/local-settings";

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
  const appointmentsQuery = useAppointments();
  const clientsQuery = useClients();
  const extrasQuery = useDayExtras();
  const teamsQuery = useTeams();
  const calendarSettingsQuery = useCalendarSettings();
  const appts = useMemo(
    () => appointmentsQuery.data ?? [],
    [appointmentsQuery.data],
  );
  const clients = useMemo(
    () => clientsQuery.data ?? [],
    [clientsQuery.data],
  );
  const extrasMap = useMemo(
    () => extrasQuery.data ?? {},
    [extrasQuery.data],
  );
  const teams = useMemo(() => teamsQuery.data ?? [], [teamsQuery.data]);
  const calendarSettings = calendarSettingsQuery.data;
  const update = useUpdateAppointment();
  const toast = useToast();
  const t = useThemeColors();
  const router = useRouter();

  // Recomputed on focus in the company's BUSINESS timezone: a dispatcher may
  // use a phone configured for another country, while the server closes days
  // according to calendar_settings.timezone. Both sides must address the same
  // date around midnight.
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
  const [actualCashStr, setActualCashStr] = useState("");
  useEffect(() => {
    setActualCashStr("");
  }, [todayKey]);

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
      // Expected TILL cash = cash-method payments + cash prepayments only.
      // A card/transfer prepayment must never inflate the physical till.
      // Cancelled/scheduled visits never hit the till in this operational
      // close-out view.
      const cash = till.reduce((s, a) => {
        // Full refunds retain their original receipt rows for audit history;
        // those rows are no longer money expected in the current cashbox.
        if (a.payment_status === "refunded") return s;
        let c = (a.payments ?? [])
          .filter((p) => p.method === "cash" && p.amount > 0)
          .reduce((ps, p) => ps + p.amount, 0);
        if ((a.prepaid_amount ?? 0) > 0 && a.payment_method === "cash") {
          c += a.prepaid_amount;
        }
        return s + c;
      }, 0);
      return { completed, inProgress, stillScheduled, unpaid, income, cash };
    }, [appts, todayKey, extrasMap, teams]);

  const fallbackExpectedCashCents = Math.round(cash * 100);
  const closureQuery = useDayClosure(todayKey, fallbackExpectedCashCents);
  const closeMutation = useCloseDay(todayKey, fallbackExpectedCashCents);
  const reopenMutation = useReopenDay(todayKey, fallbackExpectedCashCents);
  const closureState = closureQuery.data;
  const closedRec = closureState?.isClosed ? closureState : null;
  const closed = !!closedRec;
  const expectedCashCents =
    closureState?.expectedCashCents ?? fallbackExpectedCashCents;
  const expectedCash = expectedCashCents / 100;
  const actualCashCents = parseCashInputToCents(actualCashStr);
  const deltaCents =
    actualCashCents == null ? null : actualCashCents - expectedCashCents;
  const delta = (deltaCents ?? 0) / 100;

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
        patch: buildDebtPaidPatch(apt, { method: "cash", amount: debt }),
      },
      {
        onSuccess: () => {
          toast("Оплата отмечена");
          void closureQuery.refetch();
        },
        onError: (e) => Alert.alert("Ошибка", (e as Error).message),
      },
    );
  };

  const moveToTomorrow = (apt: Appointment) => {
    // Anchor the move to the same tenant-local day shown on this screen. A
    // device in another timezone must not turn «tomorrow» into today/+2 days.
    const next = parseYMD(todayKey);
    next.setDate(next.getDate() + 1);
    update.mutate(
      { id: apt.id, patch: { date: formatYMD(next) } },
      {
        onSuccess: () => toast("Перенесено на завтра"),
        onError: (e) => Alert.alert("Ошибка", (e as Error).message),
      },
    );
  };

  const doCloseDay = async () => {
    if (actualCashCents == null) {
      Alert.alert(
        "Проверьте сумму",
        "Введите сумму в евро и не больше двух знаков после запятой.",
      );
      return;
    }
    try {
      await closeMutation.mutateAsync(actualCashCents);
      toast("День закрыт");
    } catch (error) {
      Alert.alert(
        "Не удалось закрыть день",
        error instanceof Error ? error.message : "Повторите попытку.",
      );
    }
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
          { text: "Закрыть", onPress: () => void doCloseDay() },
        ],
      );
      return;
    }
    void doCloseDay();
  };
  const reopen = () => {
    Alert.alert(
      "Открыть день обратно?",
      "После открытия финансовые операции за этот день снова можно будет менять.",
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Открыть",
          onPress: async () => {
            try {
              await reopenMutation.mutateAsync();
              toast("День открыт");
            } catch (error) {
              Alert.alert(
                "Не удалось открыть день",
                error instanceof Error ? error.message : "Повторите попытку.",
              );
            }
          },
        },
      ],
    );
  };

  const sourceLoading =
    appointmentsQuery.isLoading ||
    clientsQuery.isLoading ||
    extrasQuery.isLoading ||
    teamsQuery.isLoading ||
    calendarSettingsQuery.isLoading;
  const sourceError =
    (appointmentsQuery.data === undefined ? appointmentsQuery.error : null) ||
    (clientsQuery.data === undefined ? clientsQuery.error : null) ||
    (extrasQuery.data === undefined ? extrasQuery.error : null) ||
    (teamsQuery.data === undefined ? teamsQuery.error : null) ||
    (calendarSettingsQuery.data === undefined
      ? calendarSettingsQuery.error
      : null);
  const loadError = sourceError || closureQuery.error;
  const refreshAll = () =>
    void Promise.all([
      appointmentsQuery.refetch(),
      clientsQuery.refetch(),
      extrasQuery.refetch(),
      teamsQuery.refetch(),
      calendarSettingsQuery.refetch(),
      closureQuery.refetch(),
    ]);

  if (sourceLoading || closureQuery.isLoading) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Закрыть день" />
        <EmptyState state="loading" fill subtitle="Сверяем кассу с сервером…" />
      </Screen>
    );
  }

  if (loadError) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Закрыть день" />
        <EmptyState
          state="error"
          fill
          title="Не удалось сверить кассу"
          subtitle={
            loadError instanceof Error
              ? loadError.message
              : undefined
          }
          action={{
            label: "Повторить",
            onPress: refreshAll,
          }}
        />
      </Screen>
    );
  }

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
                {closedRec.actualCashCents == null ||
                closedRec.deltaCashCents == null
                  ? "Фактическая касса не была сохранена"
                  : `Касса ${formatEUR(closedRec.actualCashCents / 100)} · ${
                      closedRec.deltaCashCents === 0
                        ? "без расхождений"
                        : closedRec.deltaCashCents > 0
                          ? `излишек ${formatEUR(closedRec.deltaCashCents / 100)}`
                          : formatEUR(closedRec.deltaCashCents / 100)
                    }`}
              </Text>
              <Pressable
                onPress={reopen}
                disabled={reopenMutation.isPending}
                accessibilityRole="button"
                accessibilityLabel="Открыть закрытый день обратно"
                className="mt-1 min-h-11 self-start justify-center active:opacity-70"
              >
                <Text
                  className="text-[13px] font-semibold underline"
                  style={{ color: t.success }}
                >
                  {reopenMutation.isPending ? "Открываем…" : "Открыть обратно"}
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

        <SectionEyebrow>Сегодня</SectionEyebrow>
        <SectionCard>
          <Row label="Завершено" value={String(completed.length)} />
          <Row label="В работе" value={String(inProgress.length)} />
          <Row label="Ещё запланировано" value={String(stillScheduled.length)} />
          <Row label="Доход" value={formatEUR(income)} tone="green" />
        </SectionCard>

        {!closed && (unpaid.length > 0 || stillScheduled.length > 0) ? (
          <>
          <SectionEyebrow>Что осталось</SectionEyebrow>
          <SectionCard>
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
                  disabled={update.isPending}
                  accessibilityRole="button"
                  accessibilityLabel={`${clientName(apt)}: отметить долг оплаченным наличными`}
                  className="min-h-11 items-center justify-center rounded-lg px-3 active:opacity-80"
                  style={{
                    backgroundColor: t.success,
                    opacity: update.isPending ? 0.55 : 1,
                  }}
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
                  disabled={update.isPending}
                  accessibilityRole="button"
                  accessibilityLabel={`${clientName(apt)}: перенести запись на завтра`}
                  className="min-h-11 items-center justify-center rounded-lg px-3 active:opacity-80"
                  style={{
                    backgroundColor: t.fill,
                    opacity: update.isPending ? 0.55 : 1,
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
          </>
        ) : null}

        {!closed ? (
          <>
          <SectionEyebrow>Касса</SectionEyebrow>
          <SectionCard padded>
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
              accessibilityLabel="Фактическая сумма наличных"
              onChangeText={setActualCashStr}
              keyboardType="decimal-pad"
              placeholder={cashCentsToInput(expectedCashCents)}
              placeholderTextColor={t.placeholder}
              selectionColor={t.accent}
              keyboardAppearance="light"
              className="h-12 rounded-[10px] px-3.5 text-[17px] tabular-nums"
              style={{
                backgroundColor: t.fill,
                color: t.ink,
              }}
            />
            {/* Тап-чип — заполняет поле ожидаемой суммой (сознательный тап,
                не автозаполнение: пересчёт кассы должен остаться честным). */}
            <Pressable
              onPress={() =>
                setActualCashStr(cashCentsToInput(expectedCashCents))
              }
              disabled={expectedCashCents < 0}
              accessibilityRole="button"
              accessibilityLabel={`Заполнить ожидаемой суммой ${formatEUR(expectedCash)}`}
              className="mt-2 min-h-11 self-start justify-center rounded-full px-3 active:opacity-60"
              style={{
                backgroundColor: "rgba(44,91,224,0.10)",
                opacity: expectedCashCents < 0 ? 0.45 : 1,
              }}
            >
              <Text
                className="text-[13px] font-medium tabular-nums"
                style={{ color: t.accent }}
              >
                = Должно быть {formatEUR(expectedCash)}
              </Text>
            </Pressable>
            {actualCashCents != null && deltaCents != null ? (
              <Text
                className="mt-2 text-[13px] font-medium tabular-nums"
                style={{ color: delta >= 0 ? t.success : t.danger }}
              >
                {delta === 0
                  ? "Касса сошлась"
                  : delta > 0
                    ? `Излишек ${formatEUR(delta)}`
                    : `Не хватает ${formatEUR(Math.abs(delta))}`}
              </Text>
            ) : null}
            {actualCashStr && actualCashCents == null ? (
              <Text className="mt-2 text-[13px]" style={{ color: t.danger }}>
                Введите сумму без минуса и не больше двух знаков после запятой
              </Text>
            ) : null}
            <View className="mt-4">
              <Button
                label={closeMutation.isPending ? "Закрываем…" : "Закрыть день"}
                onPress={closeDay}
                disabled={actualCashCents == null || closeMutation.isPending}
              />
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
          </>
        ) : null}
      </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
