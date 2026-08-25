import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Check, ChevronRight } from "lucide-react-native";
import {
  getDebtAmount,
  getPaidAmount,
  type Appointment,
} from "@babun/shared/local/appointments";
import { getDayExtras, sumExtras } from "@babun/shared/local/day-extras";
import { formatEURExact as formatEUR } from "@babun/shared/common/utils/money";
import { isOnline, useIsOnline } from "@babun/shared/sync";
import {
  FORMS_KASSA,
  FORMS_ZAPIS,
  formatCountRu,
} from "@babun/shared/common/utils/plural-ru";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { Divider } from "@/components/ui/Divider";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { useToast } from "@/components/ui/Toast";
import { haptics } from "@/lib/haptics";
import { confirmThen } from "@/lib/confirm";
import { notify } from "@/lib/notify";
import { useThemeColors } from "@/theme/colors";
import { formatYMD, parseYMD } from "@/features/appointments/helpers";
import { todayYmd } from "@/features/invoices/format";
import { useAppointments, useDayExtras } from "@/features/calendar/queries";
import { useClients } from "@/features/clients/queries";
import { useTeams } from "@/features/reference/queries";
import { useUpdateAppointment } from "@/features/calendar/mutations";
import { buildDebtPaidPatch } from "@/features/appointments/payment";
import { unclosedAppointments } from "@babun/shared/local/selectors/unclosed";
import {
  useCloseDay,
  useDayClosure,
  useReopenDay,
} from "@/features/settings/day-closures";
import { useCalendarSettings } from "@/features/settings/local-settings";
import { useAccountsWithBalances } from "@/features/finances/accounts";
import { KIND_ICON } from "@/features/finances/account-ui";
import {
  brigadeTitle,
  cashCountAlert,
  sortAccountRows,
} from "@/features/finances/accounts-sections";
import { lastCountedOn, useLastCashCounts } from "@/features/finances/cash-counts";
import { CashCountSheet } from "@/features/finances/CashCountSheet";

// ЗАКРЫТИЕ ДНЯ — ВТОРАЯ ДВЕРЬ ОДНОЙ МЕХАНИКИ (ТЗ счетов 2026-08-10 §5.5).
//
// Поля «сколько денег в кассе фактически» на этом экране БОЛЬШЕ НЕТ. Оно и
// было тем самым вторым числом: одна и та же касса отвечала на один и тот же
// вопрос дважды — здесь пальцем и в пересчёте кассы, — и через неделю ответы
// расходились, не сообщая, какой из них правда. Теперь экран показывает, какие
// кассы уже пересчитаны за сегодня, а какие нет, и открывает тот же лист
// пересчёта; факт дня складывает сервер из сверок.
//
// ОЖИДАЕМОЙ СУММЫ ЗДЕСЬ ТОЖЕ НЕТ. Строка «Должно быть» стояла ровно там, где
// человек собирается считать деньги, — а увидев учётную цифру, её вписывают.
// Это и есть слепой ввод: остаток по учёту показывается ПОСЛЕ ввода, внутри
// листа пересчёта, и только своей кассы.

/** Закрытие дня — серверная запись, как перевод и пересчёт: без сети кнопка
 *  гаснет и объясняет себя, а не крутится (ТЗ счетов §8). */
const OFFLINE_DAY_CLOSE =
  "Без сети день не закрывается — он закрывается на сервере.";

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
        className={`text-[15px] ${tone ? "font-bold" : "font-semibold"}`}
        style={{
          fontVariant: ["tabular-nums"],
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
  // ВСЕ команды, включая архивные: касса живёт дольше своей команды, и её имя
  // нужно строке пересчёта. Деньги дня тоже считаются по всем: визит архивной
  // команды в доход входит, значит её ручной day-extra обязан входить так же
  // (веб-паритет — computeFinancials на is_active не смотрит).
  const teamsQuery = useTeams({ includeInactive: true });
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
  const online = useIsOnline();

  // Recomputed on focus in the company's BUSINESS timezone: a dispatcher may
  // use a phone configured for another country, while the server closes days
  // according to calendar_settings.timezone. Both sides must address the same
  // date around midnight.
  const readBusinessToday = useCallback(
    // Тот же todayYmd, что на «Финансах»: он же переживает битую таймзону.
    () => todayYmd(calendarSettings?.timezone),
    [calendarSettings?.timezone],
  );
  // Первый кадр читает ТУ ЖЕ таймзону из кэша: инициализация «по Кипру»
  // группировала записи и кассы по чужой дате до первого фокуса — мигание
  // списков около полуночи.
  const [todayKey, setTodayKey] = useState(readBusinessToday);
  useFocusEffect(
    useCallback(() => {
      setTodayKey(readBusinessToday());
    }, [readBusinessToday]),
  );
  const nameById = useMemo(
    () => new Map(clients.map((c) => [c.id, c.full_name])),
    [clients],
  );
  const clientName = (a: Appointment) =>
    (a.client_id && nameById.get(a.client_id)) || a.comment || "Запись";

  const { completed, inProgress, stillScheduled, unpaid, income } =
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
      // calendar footer (computeDayFinance). Учётный остаток касс этот экран
      // больше не считает: его знает сервер, и спрашивают его в листе
      // пересчёта — после того, как деньги посчитаны руками.
      const extrasIncome = teams.reduce(
        (s, team) =>
          s + sumExtras(getDayExtras(extrasMap, team.id, todayKey)).income,
        0,
      );
      const income =
        till.reduce((s, a) => s + getPaidAmount(a), 0) + extrasIncome;
      return { completed, inProgress, stillScheduled, unpaid, income };
    }, [appts, todayKey, extrasMap, teams]);

  const closureQuery = useDayClosure(todayKey);
  const closeMutation = useCloseDay(todayKey);
  const reopenMutation = useReopenDay(todayKey);
  const closureState = closureQuery.data;
  const closedRec = closureState?.isClosed ? closureState : null;
  const closed = !!closedRec;

  // ─── Кассы и их сверки ───────────────────────────────────────────────────

  const accountsQuery = useAccountsWithBalances();
  const cashCounts = useLastCashCounts();
  const [countingId, setCountingId] = useState<string | null>(null);

  // Наличные кассы компании — ровно тот набор, который умеет пересчитывать
  // сервер (`kind='cash'` и только живые счета: закрытую кассу он отобьёт).
  const registers = useMemo(() => {
    const cashAccounts = (accountsQuery.data ?? []).filter(
      (a) => a.kind === "cash",
    );
    return sortAccountRows(cashAccounts).map((account) => {
      const count = cashCounts.last?.byAccount.get(account.id) ?? null;
      const countedToday = count?.businessDate === todayKey ? count : null;
      const team = account.brigade_id
        ? teams.find((item) => item.id === account.brigade_id)
        : null;
      return {
        account,
        countedToday,
        owner:
          // У счёта один владелец — команда (владелец 2026-08-15).
          team
            ? brigadeTitle(team.name)
              : // Команду удалили, а деньги в кассе остались: пересчитать её
                // всё равно надо, и назвать строку — тоже.
                "Команда удалена",
        // Та же янтарная правда, что в строке счёта на /accounts: «Не сверяли
        // 12 дней» обязано читаться одинаково на обоих экранах.
        alert: cashCountAlert(
          lastCountedOn(cashCounts.last, account.id),
          account.first_tx_on,
          todayKey,
        ),
      };
    });
  }, [accountsQuery.data, cashCounts.last, teams, todayKey]);

  const counting = countingId
    ? (registers.find((r) => r.account.id === countingId)?.account ?? null)
    : null;
  const countedTodayCount = registers.filter((r) => r.countedToday).length;
  const pendingRegisters = registers.length - countedTodayCount;
  /** Факт дня по сверкам — ровно то, что сложит сервер. Клиент его печатает и
   *  (пока не применена миграция) отдаёт старой сигнатуре закрытия. */
  const countedCents = registers.reduce(
    (sum, r) => sum + Math.round((r.countedToday?.counted ?? 0) * 100),
    0,
  );
  const countedDeltaCents = registers.reduce(
    (sum, r) => sum + Math.round((r.countedToday?.delta ?? 0) * 100),
    0,
  );

  // Следующий шаг после закрытия: бэклог прошлых дней (тот же фильтр, что
  // и в unclosed.tsx / бейдже хаба) — деньги «под вопросом» важнее всего.
  const unclosedPast = useMemo(
    () => unclosedAppointments(appts, todayKey).length,
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
          haptics.success();
          toast("Оплата отмечена");
          void closureQuery.refetch();
        },
        onError: (e) => notify("Ошибка", (e as Error).message),
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
        onError: (e) => notify("Ошибка", (e as Error).message),
      },
    );
  };

  const doCloseDay = async () => {
    try {
      await closeMutation.mutateAsync(countedCents);
      haptics.success();
      toast("День закрыт");
    } catch (error) {
      // Связь могла пропасть МЕЖДУ нажатием и ответом: тогда причина — не
      // сырое «Network request failed», а закрытая дверь.
      notify(
        "Не удалось закрыть день",
        !isOnline()
          ? OFFLINE_DAY_CLOSE
          : error instanceof Error
            ? error.message
            : "Повторите попытку.",
      );
    }
  };
  // Закрыть день с хвостами — сознательное решение, а не промах. Вопрос ОДИН
  // на оба хвоста: два алерта подряд читаются как поломка и приучают жать
  // «Закрыть», не читая.
  const closeDay = () => {
    const leftovers: string[] = [];
    if (stillScheduled.length > 0) {
      leftovers.push(
        `${formatCountRu(stillScheduled.length, FORMS_ZAPIS)} не выполнены`,
      );
    }
    if (pendingRegisters > 0) {
      leftovers.push(`${formatCountRu(pendingRegisters, FORMS_KASSA)} не сверены`);
    }
    if (leftovers.length > 0) {
      // Хвост называет последствие ИМЕННО оставшегося хвоста: предупреждение
      // о кассах при полностью сверенных кассах — враньё экрана.
      confirmThen(
        "Закрыть день?",
        {
          message: `${leftovers.join(" · ")}. ${
            pendingRegisters > 0
              ? "Несверенные кассы в итог дня не войдут."
              : "Невыполненные записи останутся в «Не закрыто»."
          }`,
          confirmLabel: "Закрыть день",
        },
        () => void doCloseDay(),
      );
      return;
    }
    void doCloseDay();
  };
  const reopen = () => {
    confirmThen(
      "Открыть день обратно?",
      {
        message: "После открытия финансовые операции за этот день снова можно будет менять.",
        confirmLabel: "Открыть",
      },
      async () => {
        try {
          await reopenMutation.mutateAsync();
          haptics.success();
          toast("День открыт");
        } catch (error) {
          notify(
            "Не удалось открыть день",
            !isOnline()
              ? "Без сети день не открывается — он открывается на сервере."
              : error instanceof Error
                ? error.message
                : "Повторите попытку.",
          );
        }
      },
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
  // Счета и сверки — часть ответа «что с кассами»: без них экран не имеет
  // права предлагать закрыть день, иначе список касс молча окажется пустым и
  // прочитается как «сверять нечего».
  const loadError =
    sourceError
    || closureQuery.error
    || (accountsQuery.data === undefined ? accountsQuery.error : null)
    || (cashCounts.last === undefined ? cashCounts.error : null);
  const refreshAll = () =>
    void Promise.all([
      appointmentsQuery.refetch(),
      clientsQuery.refetch(),
      extrasQuery.refetch(),
      teamsQuery.refetch(),
      calendarSettingsQuery.refetch(),
      closureQuery.refetch(),
      accountsQuery.refetch(),
      cashCounts.refetch(),
    ]);

  if (
    sourceLoading
    || closureQuery.isLoading
    || accountsQuery.isLoading
    || (cashCounts.isLoading && cashCounts.last === undefined)
  ) {
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
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 32 }}
      >
        {closedRec ? (
          <View
            className="mx-3 mt-2 flex-row items-start gap-3 p-4"
            style={{ backgroundColor: t.success + "1a", borderRadius: t.radius.card }}
          >
            <View
              className="h-10 w-10 items-center justify-center"
              style={{ backgroundColor: t.success, borderRadius: t.radius.input }}
            >
              <Check color={t.onAccent} size={22} strokeWidth={2.5} />
            </View>
            <View className="flex-1">
              <Text
                className="text-[17px] font-semibold"
                style={{ color: t.ink }}
              >
                День закрыт
              </Text>
              {/* Цифры закрытого дня печатаются СЕРВЕРНЫЕ: он сложил сверки
                  под замком, и его ответ — единственный. */}
              <Text className="mt-0.5 text-[13px]" style={{ color: t.sub }}>
                {closedRec.actualCashCents == null ||
                closedRec.deltaCashCents == null
                  ? "Фактическая касса не была сохранена"
                  : // Все три колонки в нуле и сверок за день нет — значит
                    // кассы не считали, а не «насчитали €0».
                    countedTodayCount === 0
                      && closedRec.actualCashCents === 0
                      && closedRec.expectedCashCents === 0
                    ? "Кассы в этот день не сверяли"
                    : `По учёту ${formatEUR(
                        closedRec.expectedCashCents / 100,
                      )} · насчитали ${formatEUR(
                        closedRec.actualCashCents / 100,
                      )} · ${
                        closedRec.deltaCashCents === 0
                          ? "сходится"
                          : closedRec.deltaCashCents > 0
                            ? `излишек ${formatEUR(closedRec.deltaCashCents / 100)}`
                            : `недостача ${formatEUR(
                                Math.abs(closedRec.deltaCashCents) / 100,
                              )}`
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
                  className="mt-3 flex-row items-center justify-between px-3 active:opacity-70"
                  style={{
                    minHeight: 44,
                    backgroundColor: t.surface,
                    borderRadius: t.radius.input,
                  }}
                >
                  <Text
                    className="text-[14px] font-semibold"
                    style={{ color: t.ink }}
                  >
                    Разобрать незакрытые дни
                  </Text>
                  <View className="flex-row items-center gap-1">
                    <Text
                      className="text-[14px] font-bold"
                      style={{ color: t.warning, fontVariant: ["tabular-nums"] }}
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
                className="mx-3 my-1 flex-row items-center gap-3 p-2"
                style={{
                  backgroundColor: t.danger + "0d",
                  borderRadius: t.radius.input,
                }}
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
                    className="text-xs"
                    style={{ color: t.sub, fontVariant: ["tabular-nums"] }}
                  >
                    {apt.time_start} · долг {formatEUR(getDebtAmount(apt))}
                  </Text>
                </View>
                <Pressable
                  onPress={() => markPaidCash(apt)}
                  disabled={update.isPending}
                  accessibilityRole="button"
                  accessibilityLabel={`${clientName(apt)}: отметить долг оплаченным наличными`}
                  className="min-h-11 items-center justify-center px-3 active:opacity-80"
                  style={{
                    backgroundColor: t.success,
                    borderRadius: t.radius.input,
                    opacity: update.isPending ? 0.55 : 1,
                  }}
                >
                  <Text
                    className="text-[13px] font-semibold"
                    style={{ color: t.onAccent }}
                  >
                    Оплачено
                  </Text>
                </Pressable>
              </View>
            ))}
            {stillScheduled.map((apt) => (
              <View
                key={apt.id}
                className="mx-3 my-1 flex-row items-center gap-3 p-2"
                style={{
                  backgroundColor: t.warning + "1a",
                  borderRadius: t.radius.input,
                }}
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
                    className="text-xs"
                    style={{ color: t.sub, fontVariant: ["tabular-nums"] }}
                  >
                    {apt.time_start}–{apt.time_end} · ещё в плане
                  </Text>
                </View>
                <Pressable
                  onPress={() => moveToTomorrow(apt)}
                  disabled={update.isPending}
                  accessibilityRole="button"
                  accessibilityLabel={`${clientName(apt)}: перенести запись на завтра`}
                  className="min-h-11 items-center justify-center px-3 active:opacity-80"
                  style={{
                    backgroundColor: t.fill,
                    borderRadius: t.radius.input,
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
          <SectionEyebrow>Кассы</SectionEyebrow>
          <SectionCard>
            {registers.length === 0 ? (
              <Text className="px-4 py-3 text-[13px]" style={{ color: t.faint }}>
                Наличных касс нет — сверять нечего.
              </Text>
            ) : (
              registers.map((item, index) => (
                <View key={item.account.id}>
                  {index > 0 ? <Divider inset={48} /> : null}
                  <SettingsRow
                    icon={KIND_ICON.cash}
                    title={item.account.name}
                    sub={
                      item.countedToday
                        ? `${item.owner} · сверено сегодня`
                        : `${item.owner} · ${
                            item.alert
                              ? item.alert.toLowerCase()
                              : "сегодня не сверяли"
                          }`
                    }
                    subColor={item.countedToday ? undefined : t.warning}
                    /* Суммы в строке НЕТ намеренно: увидев остаток по учёту
                       рядом с кнопкой «пересчитать», его же и вписывают. */
                    value={
                      item.countedToday
                        ? formatEUR(item.countedToday.counted)
                        : undefined
                    }
                    onPress={() => setCountingId(item.account.id)}
                  />
                </View>
              ))
            )}
          </SectionCard>
          <Text
            className="mx-4 mt-1.5 text-[13px]"
            style={{ color: t.faint, lineHeight: 18 }}
          >
            {registers.length === 0
              ? "День закроется без сверки касс."
              : pendingRegisters === 0
                ? "Все кассы сверены. Итог дня сложится из этих сверок."
                : `Сверено ${countedTodayCount} из ${registers.length}. `
                  + "Несверенные кассы в итог дня не войдут."}
          </Text>

          {countedTodayCount > 0 ? (
            <SectionCard>
              <Row label="Насчитали" value={formatEUR(countedCents / 100)} />
              {countedDeltaCents !== 0 ? (
                <Row
                  label={countedDeltaCents > 0 ? "Излишек" : "Недостача"}
                  value={formatEUR(Math.abs(countedDeltaCents) / 100)}
                  tone={countedDeltaCents > 0 ? "green" : "red"}
                />
              ) : (
                <Row label="Расхождений" value="нет" tone="green" />
              )}
            </SectionCard>
          ) : null}

          <View className="mx-3 mt-4">
            <Button
              label={closeMutation.isPending ? "Закрываем…" : "Закрыть день"}
              onPress={closeDay}
              // Закрытие дня пишется на сервере. Без сети кнопка гаснет и
              // называет причину строкой ниже: крутящаяся кнопка не отвечает
              // на единственный вопрос — закрылся день или нет (§8).
              disabled={closeMutation.isPending || !online}
            />
            {online ? null : (
              <Text
                className="mt-1.5 text-[13px]"
                style={{ color: t.faint, lineHeight: 18 }}
              >
                {OFFLINE_DAY_CLOSE}
              </Text>
            )}
          </View>
          </>
        ) : null}
      </ScrollView>

      {/* ТОТ ЖЕ ЛИСТ, что и на счетах: сверка у продукта одна, а дверей две. */}
      <CashCountSheet
        visible={counting !== null}
        onClose={() => setCountingId(null)}
        account={counting}
        subtitle={
          counting
            ? `${counting.name} · ${
                registers.find((r) => r.account.id === counting.id)?.owner ?? ""
              }`
            : ""
        }
      />
    </Screen>
  );
}
