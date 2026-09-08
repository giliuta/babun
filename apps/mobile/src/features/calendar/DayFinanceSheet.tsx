import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { X } from "lucide-react-native";
import type { Appointment } from "@babun/shared/local/appointments";
import { getDebtAmount } from "@babun/shared/local/appointments";
import { formatEUR } from "@babun/shared/common/utils/money";
import { computeDayFinance } from "@babun/shared/local/finance/day-summary";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import { canEditTransaction } from "@babun/shared/local/finance/transaction";
import type { DayExtra } from "@babun/shared/local/day-extras";
import { getDayExtras } from "@babun/shared/local/day-extras";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { RowGroup } from "@/components/ui/card-rows";
import { GradientButton } from "@/components/ui/GradientButton";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { ICON } from "@/components/ui/tokens";
import { parseYMD } from "@/features/appointments/helpers";
import { ledgerExtrasForDay } from "@/features/calendar/day-ledger";
import {
  useDayExtras,
  useFinanceServices,
  useSetDayExtras,
} from "@/features/calendar/queries";
import { useClients } from "@/features/clients/queries";
import { incomeDeals } from "@/features/finances/income-deals";
import { materialExpenseRows } from "@/features/finances/material-expenses";
import { OperationSheet } from "@/features/finances/OperationSheet";
import { useTransactions } from "@/features/finances/queries";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// ФИНАНСЫ ДНЯ — ЛИСТ СНИЗУ (владелец 2026-09-07: «нижнюю строку доход/расход
// сделаем качественнее: чтобы снизу вверх поднималась плашка и можно было
// выбирать»). Раньше по тапу на футер всплывала карточка посреди экрана со
// своим редактором «ручных операций дня» — отдельной от леджера схемой.
//
// Теперь лист — канонический BottomSheet: итоги дня, переключатель
// Доход · Расход · Ожидается и список ТЕХ ЖЕ денег, что на вкладке «Финансы»:
// сделки дня (снятые оплаты спрятаны парой), расходы с материалами записей,
// неоплаченные записи. Тап по строке записи открывает запись, по ручной
// операции — её правку. «Добавить операцию» — та же форма, что в «Финансах»,
// с датой этого дня. Старые «ручные операции дня» показываются и удаляются,
// новые не заводятся: деньги живут в одном леджере.

type Segment = "income" | "expense" | "pending";

const SEGMENTS = [
  { value: "income", label: "Доход" },
  { value: "expense", label: "Расход" },
  { value: "pending", label: "Ожидается" },
] as const;

export function DayFinanceSheet({
  dateYmd,
  appointments,
  teamId,
  businessToday,
  onClose,
  onEditAppointment,
}: {
  /** День разбора (null = закрыто). */
  dateYmd: string | null;
  /** Записи этого дня, уже отфильтрованные по команде. */
  appointments: Appointment[];
  teamId: string | null;
  /** Сегодня по времени бизнеса — будущий день операций не принимает. */
  businessToday: string;
  onClose: () => void;
  /** Открыть запись из «Ожидается» — чтобы отметить оплату. */
  onEditAppointment?: (a: Appointment) => void;
}) {
  const t = useThemeColors();
  const router = useRouter();
  const services = useFinanceServices();
  const { data: extrasMap = {} } = useDayExtras();
  const { data: clients = [] } = useClients();
  const setExtras = useSetDayExtras();
  const [segment, setSegment] = useState<Segment>("income");

  // Лист остаётся смонтированным с dateYmd=null: последний открытый день
  // держим, чтобы содержимое не пустело на анимации ухода.
  const [shownYmd, setShownYmd] = useState<string | null>(dateYmd);
  useEffect(() => {
    if (dateYmd != null) {
      setShownYmd(dateYmd);
      setSegment("income");
    }
  }, [dateYmd]);
  const ymd = shownYmd ?? businessToday;

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

  const incomeRows = useMemo(() => incomeDeals(dayTx), [dayTx]);
  const expenseRows = useMemo(
    () => [
      ...dayTx.filter((tx) => tx.type === "expense"),
      ...materialExpenseRows(appointments, services, { from: ymd, to: ymd, teamId }),
    ],
    [dayTx, appointments, services, ymd, teamId],
  );
  const pendingAppts = useMemo(
    () =>
      appointments
        .filter((a) => a.status !== "cancelled" && getDebtAmount(a) > 0)
        .sort((a, b) => a.time_start.localeCompare(b.time_start)),
    [appointments],
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

  const isFuture = ymd > businessToday;
  const dateLabel = shownYmd
    ? (() => {
        const s = parseYMD(shownYmd).toLocaleDateString("ru-RU", {
          weekday: "short",
          day: "numeric",
          month: "long",
        });
        return s.charAt(0).toUpperCase() + s.slice(1);
      })()
    : "";

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
    const services = appt?.services?.map((s) => s.serviceName).filter(Boolean).join(", ");
    if (tx.type === "income" || tx.type === "refund") {
      return services || tx.notes || (tx.type === "refund" ? "Возврат" : "Поступление");
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
    segment === "pending"
      ? []
      : legacyExtras.filter((e) => e.kind === segment);
  const listTx = segment === "income" ? incomeRows : segment === "expense" ? expenseRows : [];
  const listEmpty =
    segment === "pending"
      ? pendingAppts.length === 0
      : listTx.length === 0 && listExtras.length === 0;

  return (
    <>
      <BottomSheet
        visible={dateYmd != null}
        onClose={onClose}
        title={dateLabel}
        padded={false}
        scroll
        maxHeightRatio={0.9}
        onExited={() => {
          const run = afterExit.current;
          afterExit.current = null;
          run?.();
        }}
        footer={
          // Будущий день денег ещё не видел: леджер не принимает операции
          // вперёд, и кнопка честно отсутствует.
          !isFuture ? (
            <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8 }}>
              <GradientButton
                label="Добавить операцию"
                onPress={() =>
                  openOperation(null, segment === "expense" ? "expense" : "income")
                }
              />
            </View>
          ) : undefined
        }
      >
        <View style={{ backgroundColor: t.canvas, paddingBottom: 12 }}>
          <RowGroup>
            <TotalRow
              label={isFuture ? "Запланировано" : "Заработано"}
              value={isFuture ? totals.planned : totals.earned}
              color={t.success}
            />
            <TotalRow label="Расход" value={totals.spent} color={t.danger} separated />
            {/* У будущего дня прибыли ещё нет — есть только план. */}
            {!isFuture ? (
              <TotalRow
                label="Прибыль"
                value={totals.profit}
                color={totals.profit < 0 ? t.danger : t.accent}
                bold
                separated
              />
            ) : null}
          </RowGroup>

          <SegmentedControl
            options={SEGMENTS}
            value={segment}
            onChange={setSegment}
            style={{ marginHorizontal: 16, marginTop: 12 }}
          />

          <RowGroup>
            {segment === "pending"
              ? pendingAppts.map((a, i) => (
                  <LedgerRow
                    key={a.id}
                    time={a.time_start}
                    title={clientName(a)}
                    amount={getDebtAmount(a)}
                    color={t.warning}
                    separated={i > 0}
                    onPress={() => openRecord(a.id)}
                  />
                ))
              : listTx.map((tx, i) => (
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
                {segment === "pending" ? "Неоплаченных записей нет" : "Операций нет"}
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

function TotalRow({
  label,
  value,
  color,
  bold,
  separated,
}: {
  label: string;
  value: number;
  color: string;
  bold?: boolean;
  separated?: boolean;
}) {
  const t = useThemeColors();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        minHeight: 44,
        paddingHorizontal: 16,
        borderTopWidth: separated ? 1 : 0,
        borderTopColor: t.separator,
      }}
    >
      <Text style={{ flex: 1, fontSize: 15, color: t.ink, fontWeight: bold ? "600" : "400" }}>
        {label}
      </Text>
      <Text
        className="tabular-nums"
        style={{ fontSize: 15, fontWeight: "600", color: value !== 0 ? color : t.faint }}
      >
        {formatEUR(value)}
      </Text>
    </View>
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
