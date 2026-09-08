import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, useWindowDimensions, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { X } from "lucide-react-native";
import type { Appointment } from "@babun/shared/local/appointments";
import { getDebtAmount } from "@babun/shared/local/appointments";
import { formatEUR, moneySign } from "@babun/shared/common/utils/money";
import { computeDayFinance } from "@babun/shared/local/finance/day-summary";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import { canEditTransaction } from "@babun/shared/local/finance/transaction";
import type { DayExtra } from "@babun/shared/local/day-extras";
import { getDayExtras } from "@babun/shared/local/day-extras";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { RowGroup } from "@/components/ui/card-rows";
import { GradientButton } from "@/components/ui/GradientButton";
import { ICON } from "@/components/ui/tokens";
import { formatHM } from "@/features/appointments/helpers";
import {
  dayDebtRecords,
  ledgerExtrasForDay,
} from "@/features/calendar/day-ledger";
import {
  useDayExtras,
  useFinanceServices,
  useSetDayExtras,
} from "@/features/calendar/queries";
import { useClients } from "@/features/clients/queries";
import { SummaryToggle } from "@/features/finances/FinanceOverview";
import { incomeDeals } from "@/features/finances/income-deals";
import { materialExpenseRows } from "@/features/finances/material-expenses";
import { OperationSheet } from "@/features/finances/OperationSheet";
import { useTransactions } from "@/features/finances/queries";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// ФИНАНСЫ ДНЯ — ЛИСТ СНИЗУ С ПЛИТКАМИ КАК В «ФИНАНСАХ» (владелец 2026-09-08:
// «тапаю внизу — снизу поднимается плашка; сверху четыре блока, как в
// финансах: доход слева вверху, расход справа, долг слева внизу, ожидается
// справа внизу — серым, оно менее важное; шторка на 50–75 %, чтобы вошли все
// операции дня; даты сверху не надо; внизу синяя кнопка, и она меняется:
// добавить доход · добавить расход · добавить долг, у ожидается — добавить
// операцию»).
//
// Смысл плиток — строго по дню:
//   Доход     — только то, что уже ОПЛАЧЕНО (плюс ручные доходы);
//   Расход    — операции дня и материалы записей;
//   Долг      — время записи прошло, а «оплачено» не нажали;
//   Ожидается — что ещё предстоит по записям дня.
// Под плитками — список выбранной плитки, теми же деньгами, что на вкладке
// «Финансы». Тап по записи открывает запись, по ручной операции — её правку.
// Кнопка внизу ведёт в ту же форму операции, что в «Финансах», сразу на этом
// дне (доход и расход — по категориям, не по услугам); «Добавить долг» — это
// новая запись на этот день: долг рождается только у записи.

type DayView = "income" | "expense" | "debt" | "planned";

export function DayFinanceSheet({
  dateYmd,
  appointments,
  teamId,
  businessToday,
  onClose,
  onEditAppointment,
  onCreateRecord,
}: {
  /** День разбора (null = закрыто). */
  dateYmd: string | null;
  /** Записи этого дня, уже отфильтрованные по команде. */
  appointments: Appointment[];
  teamId: string | null;
  /** Сегодня по времени бизнеса — будущий день операций не принимает. */
  businessToday: string;
  onClose: () => void;
  /** Открыть запись — отметить оплату, посмотреть работу. */
  onEditAppointment?: (a: Appointment) => void;
  /** «Добавить долг» — новая запись на этот день (долг бывает только у
   *  записи). Нет права записывать — кнопки нет. */
  onCreateRecord?: (ymd: string) => void;
}) {
  const t = useThemeColors();
  const router = useRouter();
  const { height: screenH } = useWindowDimensions();
  const services = useFinanceServices();
  const { data: extrasMap = {} } = useDayExtras();
  const { data: clients = [] } = useClients();
  const setExtras = useSetDayExtras();
  const [view, setView] = useState<DayView>("income");

  // Лист остаётся смонтированным с dateYmd=null: последний открытый день
  // держим, чтобы содержимое не пустело на анимации ухода.
  const [shownYmd, setShownYmd] = useState<string | null>(dateYmd);
  useEffect(() => {
    if (dateYmd != null) {
      setShownYmd(dateYmd);
      setView("income");
    }
  }, [dateYmd]);
  const ymd = shownYmd ?? businessToday;
  const nowHm = formatHM(new Date());

  const txQuery = useTransactions(ymd, ymd, {
    brigadeIds: teamId ? [teamId] : undefined,
    enabled: shownYmd != null,
  });
  const dayTx = useMemo(() => txQuery.data ?? [], [txQuery.data]);

  const legacyExtras = useMemo(
    () => (shownYmd ? getDayExtras(extrasMap, teamId, shownYmd) : []),
    [extrasMap, teamId, shownYmd],
  );
  const totals = useMemo(
    () =>
      computeDayFinance(appointments, services, [
        ...legacyExtras,
        ...ledgerExtrasForDay(dayTx, ymd),
      ]),
    [appointments, services, legacyExtras, dayTx, ymd],
  );

  const plannedRecords = useMemo(
    () =>
      appointments
        .filter((a) => a.status !== "cancelled" && a.total_amount > 0)
        .sort((a, b) => a.time_start.localeCompare(b.time_start)),
    [appointments],
  );
  const debtRecords = useMemo(
    () => dayDebtRecords(appointments, businessToday, nowHm),
    [appointments, businessToday, nowHm],
  );
  const debtTotal = debtRecords.reduce((sum, a) => sum + getDebtAmount(a), 0);
  const incomeRows = useMemo(() => incomeDeals(dayTx), [dayTx]);
  const expenseRows = useMemo(
    () => [
      ...dayTx.filter((tx) => tx.type === "expense"),
      ...materialExpenseRows(appointments, services, { from: ymd, to: ymd, teamId }),
    ],
    [dayTx, appointments, services, ymd, teamId],
  );

  const nameById = useMemo(
    () => new Map(clients.map((c) => [c.id, c.full_name])),
    [clients],
  );
  const apptById = useMemo(
    () => new Map(appointments.map((a) => [a.id, a])),
    [appointments],
  );
  const clientName = (a: Appointment) =>
    (a.client_id ? nameById.get(a.client_id) : null) || a.comment?.trim() || "Без имени";
  const servicesOf = (a: Appointment) =>
    (a.services ?? []).map((s) => s.serviceName).filter(Boolean).join(", ");

  const isFuture = ymd > businessToday;

  // ФОРМА ОПЕРАЦИИ — ПОСЛЕ УХОДА ЛИСТА: второй системный Modal поверх
  // уходящего iOS молча не показывает (тот же закон, что у попапа финансов).
  const [opOpen, setOpOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<FinanceTransaction | null>(null);
  const [opType, setOpType] = useState<"income" | "expense">("expense");
  const afterExit = useRef<(() => void) | null>(null);
  const openOperation = (tx: FinanceTransaction | null, type: "income" | "expense") => {
    setEditingTx(tx);
    setOpType(type);
    afterExit.current = () => setOpOpen(true);
    onClose();
  };
  const openRecord = (appointmentId: string) => {
    const known = apptById.get(appointmentId);
    afterExit.current = () => {
      if (known && onEditAppointment) onEditAppointment(known);
      else router.push(`/book?appointmentId=${appointmentId}` as Href);
    };
    onClose();
  };
  const removeLegacy = (id: string) => {
    if (!teamId || !shownYmd) return;
    haptics.tap();
    setExtras.mutate({
      teamId,
      dateKey: shownYmd,
      extras: legacyExtras.filter((e) => e.id !== id),
    });
  };

  const rowTitle = (tx: FinanceTransaction): string => {
    const appt = tx.appointment_id ? apptById.get(tx.appointment_id) : null;
    const names = appt ? servicesOf(appt) : "";
    if (tx.type === "income" || tx.type === "refund") {
      return names || tx.notes || (tx.type === "refund" ? "Возврат" : "Поступление");
    }
    return tx.notes || "Расход";
  };
  const rowContext = (tx: FinanceTransaction): string => {
    const appt = tx.appointment_id ? apptById.get(tx.appointment_id) : null;
    const time = appt?.time_start || tx.occurred_time || "";
    const who = tx.client_id ? nameById.get(tx.client_id) ?? "" : "";
    return [time, who].filter(Boolean).join(" · ");
  };

  const listExtras: DayExtra[] =
    view === "income" || view === "expense"
      ? legacyExtras.filter((e) => e.kind === view)
      : [];
  const listTx = view === "income" ? incomeRows : view === "expense" ? expenseRows : [];
  const listRecords = view === "planned" ? plannedRecords : view === "debt" ? debtRecords : [];
  const listEmpty = listTx.length === 0 && listExtras.length === 0 && listRecords.length === 0;
  const emptyText =
    view === "planned"
      ? "Записей нет"
      : view === "debt"
        ? "Долгов нет"
        : "Операций нет";

  const pick = (next: DayView) => {
    haptics.tap();
    setView(next);
  };

  // КНОПКА СЛЕДУЕТ ЗА ПЛИТКОЙ. Будущий день операций не принимает (леджер
  // не пишет вперёд), поэтому там остаётся только «Добавить долг» — новая
  // запись на этот день.
  const cta: { label: string; onPress: () => void } | null =
    view === "debt"
      ? onCreateRecord
        ? {
            label: "Добавить долг",
            onPress: () => {
              afterExit.current = () => onCreateRecord(ymd);
              onClose();
            },
          }
        : null
      : isFuture
        ? null
        : view === "income"
          ? { label: "Добавить доход", onPress: () => openOperation(null, "income") }
          : view === "expense"
            ? { label: "Добавить расход", onPress: () => openOperation(null, "expense") }
            : { label: "Добавить операцию", onPress: () => openOperation(null, "expense") };

  return (
    <>
      <BottomSheet
        visible={dateYmd != null}
        onClose={onClose}
        padded={false}
        scroll
        // Шторка встаёт на 50–75 % экрана (владелец): содержимое держит
        // минимум высоты, а список длиннее — прокручивается внутри.
        maxHeightRatio={0.75}
        onExited={() => {
          const run = afterExit.current;
          afterExit.current = null;
          run?.();
        }}
        footer={
          cta ? (
            <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8 }}>
              <GradientButton label={cta.label} onPress={cta.onPress} />
            </View>
          ) : undefined
        }
      >
        <View
          style={{
            backgroundColor: t.canvas,
            paddingBottom: 12,
            minHeight: Math.round(screenH * 0.55),
          }}
        >
          {/* ЧЕТЫРЕ ПЛИТКИ — ТЕ ЖЕ, ЧТО НА «ФИНАНСАХ» (SummaryToggle): цвет
              несёт смысл, тинт — только у выбранной. */}
          <View style={{ paddingHorizontal: 16, paddingTop: 12, gap: 6 }}>
            <View style={{ flexDirection: "row", gap: 6 }}>
              <SummaryToggle
                label="Доход"
                color={moneySign(totals.earned) < 0 ? t.danger : t.success}
                value={formatEUR(totals.earned)}
                active={view === "income"}
                onPress={() => pick("income")}
              />
              <SummaryToggle
                label="Расход"
                color={t.danger}
                value={formatEUR(totals.spent)}
                active={view === "expense"}
                onPress={() => pick("expense")}
              />
            </View>
            <View style={{ flexDirection: "row", gap: 6 }}>
              <SummaryToggle
                label="Долг"
                color={t.warning}
                value={formatEUR(debtTotal)}
                active={view === "debt"}
                onPress={() => pick("debt")}
              />
              {/* Серым: план — не деньги, а то, что ещё предстоит. */}
              <SummaryToggle
                label="Ожидается"
                color={t.sub}
                value={formatEUR(totals.planned)}
                active={view === "planned"}
                onPress={() => pick("planned")}
              />
            </View>
          </View>

          <RowGroup>
            {listRecords.map((a, i) => (
              <LedgerRow
                key={a.id}
                time={[a.time_start, servicesOf(a)].filter(Boolean).join(" · ")}
                title={clientName(a)}
                amount={view === "debt" ? getDebtAmount(a) : a.total_amount}
                color={view === "debt" ? t.warning : t.sub}
                separated={i > 0}
                onPress={() => openRecord(a.id)}
              />
            ))}
            {listTx.map((tx, i) => (
              <LedgerRow
                key={tx.id}
                time={rowContext(tx)}
                title={rowTitle(tx)}
                amount={tx.amount}
                sign={tx.type === "expense" || tx.type === "refund" ? "−" : ""}
                color={tx.type === "expense" || tx.type === "refund" ? t.danger : t.success}
                separated={i > 0}
                onPress={() => {
                  if (tx.appointment_id) {
                    openRecord(tx.appointment_id);
                    return;
                  }
                  if (canEditTransaction(tx)) {
                    openOperation(tx, tx.type === "expense" ? "expense" : "income");
                  }
                }}
              />
            ))}
            {listExtras.map((e, i) => (
              <LedgerRow
                key={e.id}
                time="Ручная запись дня"
                title={e.name}
                amount={e.amount}
                sign={e.kind === "expense" ? "−" : ""}
                color={e.kind === "expense" ? t.danger : t.success}
                separated={i > 0 || listTx.length > 0}
                onRemove={teamId ? () => removeLegacy(e.id) : undefined}
              />
            ))}
            {listEmpty ? (
              <Text
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 14,
                  textAlign: "center",
                  fontSize: 14,
                  color: t.faint,
                }}
              >
                {emptyText}
              </Text>
            ) : null}
          </RowGroup>
        </View>
      </BottomSheet>

      <OperationSheet
        visible={opOpen}
        onClose={() => setOpOpen(false)}
        defaultTeamId={teamId}
        defaultType={opType}
        defaultDate={shownYmd}
        businessToday={businessToday}
        transaction={editingTx}
      />
    </>
  );
}

function LedgerRow({
  time,
  title,
  amount,
  sign = "",
  color,
  separated,
  onPress,
  onRemove,
}: {
  time: string;
  title: string;
  amount: number;
  sign?: string;
  color: string;
  separated?: boolean;
  onPress?: () => void;
  onRemove?: () => void;
}) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={`${title}, ${sign}${formatEUR(Math.abs(amount))}`}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        minHeight: 56,
        paddingLeft: 16,
        paddingRight: onRemove ? 8 : 16,
        borderTopWidth: separated ? 1 : 0,
        borderTopColor: t.separator,
        backgroundColor: pressed && onPress ? t.pressed : "transparent",
      })}
    >
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: "600", color: t.ink }}>
          {title}
        </Text>
        {time ? (
          <Text numberOfLines={1} style={{ fontSize: 13, color: t.sub }}>
            {time}
          </Text>
        ) : null}
      </View>
      <Text className="tabular-nums" style={{ fontSize: 15, fontWeight: "600", color }}>
        {sign}
        {formatEUR(Math.abs(amount))}
      </Text>
      {onRemove ? (
        <Pressable
          onPress={onRemove}
          accessibilityRole="button"
          accessibilityLabel={`Удалить «${title}»`}
          hitSlop={8}
          style={({ pressed }) => ({
            width: 36,
            height: 36,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 999,
            backgroundColor: pressed ? t.rowFillPressed : t.rowFill,
          })}
        >
          <X color={t.faint} size={ICON.xs} />
        </Pressable>
      ) : null}
    </Pressable>
  );
}
