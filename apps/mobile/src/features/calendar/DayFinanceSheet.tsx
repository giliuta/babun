import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, useWindowDimensions, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { X } from "lucide-react-native";
import type { Appointment } from "@babun/shared/local/appointments";
import { getDebtAmount, getPaidAmount } from "@babun/shared/local/appointments";
import {
  formatEURExact as formatEUR,
  moneySign,
} from "@babun/shared/common/utils/money";
import {
  computeDayFinance,
  isPlannedRecord,
} from "@babun/shared/local/finance/day-summary";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import { canEditTransaction } from "@babun/shared/local/finance/transaction";
import type { DayExtra } from "@babun/shared/local/day-extras";
import { getDayExtras } from "@babun/shared/local/day-extras";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { RowGroup } from "@/components/ui/card-rows";
import { EmptyState } from "@/components/ui/EmptyState";
import { GradientButton } from "@/components/ui/GradientButton";
import { ICON } from "@/components/ui/tokens";
import { formatHM, humanDay } from "@/features/appointments/helpers";
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
import {
  useFinanceCategories,
  useTransactions,
} from "@/features/finances/queries";
import { confirmThen } from "@/lib/confirm";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// ФИНАНСЫ ДНЯ — ЛИСТ СНИЗУ С ПЛИТКАМИ КАК В «ФИНАНСАХ» (владелец 2026-09-08:
// «тапаю внизу — снизу поднимается плашка; сверху четыре блока, как в
// финансах: доход слева вверху, расход справа, долг слева внизу, ожидается
// справа внизу — серым, оно менее важное; шторка на 50–75 %, чтобы вошли все
// операции дня; даты сверху не надо; внизу синяя кнопка, и она меняется:
// добавить доход · добавить расход · добавить долг, у ожидается — добавить
// операцию; вместо „Операций нет“ — просто пусто»).
//
// Смысл плиток — строго по дню:
//   Доход     — только то, что уже ОПЛАЧЕНО (плюс ручные доходы);
//   Расход    — операции дня и материалы записей;
//   Долг      — время записи прошло, а «оплачено» не нажали;
//   Ожидается — что ещё предстоит по записям дня.
// Под плитками — список выбранной плитки, теми же деньгами и той же
// грамматикой строк, что на вкладке «Финансы» (пилюля цвета знака, контекст
// над названием). Записи (Долг, Ожидается) — грамматикой списка должников:
// долг — не транзакция. Тап по записи открывает запись, по ручной операции —
// её правку; там, где открыть нечего, тапа нет.
//
// КНОПКА ВНИЗУ — ВСЕГДА ОПЕРАЦИЯ ИЗ «ФИНАНСОВ» (владелец 2026-09-08: «это
// финансы в календаре — вся система из страницы финансов, а не из „создать
// запись“»): «Добавить доход» и «Добавить расход» на своих плитках, иначе
// «Добавить операцию» — та же форма по категориям, что на вкладке. День
// подставляется в форму; будущий день леджер не принимает, поэтому форма
// открывается на сегодняшней дате и показывает её в строке «Дата».
//
// Старые «ручные операции дня» (day_extras) показываются и удаляются с
// вопросом; новых не заводится — деньги живут в одном леджере.

// «all» — плитка не выбрана: план дня целиком (владелец 2026-09-08: «под
// долгом прописывается день, ниже — всё остальное по времени записей;
// если снимаю выбор с плитки, показывается всё, и „ожидается“ с услугами»).
type DayView = "all" | "income" | "expense" | "debt" | "planned";

export function DayFinanceSheet({
  dateYmd,
  appointments,
  teamId,
  businessToday,
  onClose,
  onEditAppointment,
  onReopen,
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
  /** Форма операции закрылась — вернуть разбор того же дня, с той же плиткой. */
  onReopen?: (ymd: string) => void;
}) {
  const t = useThemeColors();
  const router = useRouter();
  const { height: screenH } = useWindowDimensions();
  const services = useFinanceServices();
  const { data: extrasMap = {} } = useDayExtras();
  const { data: clients = [] } = useClients();
  const { data: categories = [] } = useFinanceCategories();
  const setExtras = useSetDayExtras();
  const [view, setView] = useState<DayView>("all");

  // Лист остаётся смонтированным с dateYmd=null: последний открытый день и
  // его записи держим снимком, чтобы содержимое не мигало на анимации ухода.
  // Новый день открывается планом целиком (плитка не выбрана); на том же
  // дне повторное открытие плитку не сбрасывает (после формы операции
  // человек возвращается туда, откуда ушёл).
  const [shownYmd, setShownYmd] = useState<string | null>(dateYmd);
  const [shownAppts, setShownAppts] = useState<Appointment[]>(appointments);
  useEffect(() => {
    if (dateYmd == null) return;
    if (dateYmd !== shownYmd) setView("all");
    setShownYmd(dateYmd);
    setShownAppts(appointments);
  }, [dateYmd, appointments, shownYmd]);
  const ymd = shownYmd ?? businessToday;
  const appts = shownAppts;
  const nowHm = formatHM(new Date());

  const txQuery = useTransactions(ymd, ymd, {
    brigadeIds: teamId ? [teamId] : undefined,
    enabled: shownYmd != null,
  });
  // keepPreviousData подсовывает прошлый день под новыми плитками — режем
  // строго по дню, как это делает ledgerExtrasForDay для цифр.
  const dayTx = useMemo(
    () => (txQuery.data ?? []).filter((tx) => tx.occurred_on === ymd),
    [txQuery.data, ymd],
  );
  const ledgerLoading =
    (txQuery.isPending && txQuery.data === undefined) || txQuery.isPlaceholderData;

  const legacyExtras = useMemo(
    () => (shownYmd ? getDayExtras(extrasMap, teamId, shownYmd) : []),
    [extrasMap, teamId, shownYmd],
  );
  const totals = useMemo(
    () =>
      computeDayFinance(appts, services, [
        ...legacyExtras,
        ...ledgerExtrasForDay(dayTx, ymd),
      ]),
    [appts, services, legacyExtras, dayTx, ymd],
  );

  const apptById = useMemo(() => new Map(appts.map((a) => [a.id, a])), [appts]);
  const nameById = useMemo(
    () => new Map(clients.map((c) => [c.id, c.full_name])),
    [clients],
  );
  const categoryName = useMemo(
    () => new Map(categories.map((c) => [c.id, c.name])),
    [categories],
  );

  const plannedRecords = useMemo(
    () =>
      appts
        .filter((a) => isPlannedRecord(a) && a.total_amount > 0)
        .sort((a, b) => a.time_start.localeCompare(b.time_start)),
    [appts],
  );
  const debtRecords = useMemo(
    () => dayDebtRecords(appts, businessToday, nowHm),
    [appts, businessToday, nowHm],
  );
  const debtTotal = debtRecords.reduce((sum, a) => sum + getDebtAmount(a), 0);
  // Доход — сделки дня; оплата чужой записи (предоплата за завтра) в плитке
  // не считается, значит и в списке ей не место.
  const incomeRows = useMemo(
    () =>
      incomeDeals(dayTx).filter(
        (tx) => !tx.appointment_id || apptById.has(tx.appointment_id),
      ),
    [dayTx, apptById],
  );
  const materialRows = useMemo(
    () => materialExpenseRows(appts, services, { from: ymd, to: ymd, teamId }),
    [appts, services, ymd, teamId],
  );
  const expenseRows = useMemo(
    () => [...dayTx.filter((tx) => tx.type === "expense"), ...materialRows],
    [dayTx, materialRows],
  );
  // ПЛАН ДНЯ — всё по времени: записи дня (оплачено · долг · ожидается) и
  // операции без записи; проводки записей не дублируют сами записи.
  const timeOfTx = (tx: FinanceTransaction): string =>
    (tx.appointment_id ? apptById.get(tx.appointment_id)?.time_start : null) ||
    tx.occurred_time ||
    "24:00";
  const dayPlan = useMemo(() => {
    const items: { key: string; time: string; record?: Appointment; tx?: FinanceTransaction }[] = [];
    for (const a of appts) {
      if (a.status === "cancelled") continue;
      items.push({ key: `a:${a.id}`, time: a.time_start, record: a });
    }
    for (const tx of dayTx) {
      if (tx.appointment_id) continue;
      if (tx.type !== "income" && tx.type !== "expense" && tx.type !== "refund") continue;
      items.push({ key: `t:${tx.id}`, time: timeOfTx(tx), tx });
    }
    for (const tx of materialRows) items.push({ key: `m:${tx.id}`, time: timeOfTx(tx), tx });
    return items.sort((x, y) => x.time.localeCompare(y.time));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- timeOfTx читает apptById, он в зависимостях
  }, [appts, dayTx, materialRows, apptById]);

  const clientName = (a: Appointment) =>
    (a.client_id ? nameById.get(a.client_id) : null) || a.comment?.trim() || "Без имени";
  const servicesOf = (a: Appointment) =>
    (a.services ?? []).map((s) => s.serviceName).filter(Boolean).join(", ");

  // ФОРМА ОПЕРАЦИИ И ЗАПИСЬ — ПОСЛЕ УХОДА ЛИСТА: второй системный Modal
  // поверх уходящего iOS молча не показывает (тот же закон, что у попапа
  // финансов). Пока лист уходит, тапы не принимаются — второй тап затирал бы
  // отложенное действие.
  const [opOpen, setOpOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<FinanceTransaction | null>(null);
  const [opType, setOpType] = useState<"income" | "expense">("expense");
  const afterExit = useRef<(() => void) | null>(null);
  const leaveThen = (run: () => void) => {
    afterExit.current = run;
    onClose();
  };
  const openOperation = (tx: FinanceTransaction | null, type: "income" | "expense") => {
    setEditingTx(tx);
    setOpType(type);
    leaveThen(() => setOpOpen(true));
  };
  const openRecord = (appointmentId: string) => {
    const known = apptById.get(appointmentId);
    leaveThen(() => {
      if (known && onEditAppointment) onEditAppointment(known);
      else router.push(`/book?appointmentId=${appointmentId}` as Href);
    });
  };
  const askRemoveLegacy = (e: DayExtra) => {
    if (!teamId || !shownYmd) return;
    haptics.tap();
    const day = shownYmd;
    const rest = legacyExtras.filter((x) => x.id !== e.id);
    leaveThen(() =>
      confirmThen(
        "Удалить операцию?",
        {
          message: `«${e.name}» исчезнет из финансов этого дня.`,
          confirmLabel: "Удалить",
          destructive: true,
        },
        () => setExtras.mutate({ teamId, dateKey: day, extras: rest }),
      ),
    );
  };

  // Заголовок и контекст строки — той же грамматикой, что лента «Финансов»:
  // доход по записи называется её услугами, расход — категорией.
  const rowTitle = (tx: FinanceTransaction): string => {
    const appt = tx.appointment_id ? apptById.get(tx.appointment_id) : null;
    const names = appt ? servicesOf(appt) : "";
    const cat = tx.category_id ? categoryName.get(tx.category_id) : null;
    if (tx.type === "income" || tx.type === "refund") {
      return names || tx.notes || cat || (tx.type === "refund" ? "Возврат" : "Поступление");
    }
    return cat || tx.notes || "Расход";
  };
  const rowContext = (tx: FinanceTransaction): string => {
    const appt = tx.appointment_id ? apptById.get(tx.appointment_id) : null;
    const time = appt?.time_start || tx.occurred_time || "";
    if (tx.type === "income" || tx.type === "refund") {
      const who = tx.client_id ? nameById.get(tx.client_id) ?? "" : "";
      return [time, who].filter(Boolean).join(" · ");
    }
    const cat = tx.category_id ? categoryName.get(tx.category_id) : null;
    return [time, cat && tx.notes ? tx.notes : ""].filter(Boolean).join(" · ");
  };
  const rowAction = (tx: FinanceTransaction): (() => void) | undefined => {
    if (tx.appointment_id) {
      const id = tx.appointment_id;
      return () => openRecord(id);
    }
    if (canEditTransaction(tx)) {
      return () => openOperation(tx, tx.type === "expense" ? "expense" : "income");
    }
    return undefined;
  };

  const listExtras: DayExtra[] =
    view === "income" || view === "expense"
      ? legacyExtras.filter((e) => e.kind === view)
      : view === "all"
        ? legacyExtras
        : [];
  const listTx = view === "income" ? incomeRows : view === "expense" ? expenseRows : [];
  const listRecords = view === "planned" ? plannedRecords : view === "debt" ? debtRecords : [];
  const listLoading = (view === "income" || view === "expense" || view === "all") && ledgerLoading;
  const listEmpty =
    view === "all"
      ? dayPlan.length === 0 && listExtras.length === 0
      : listTx.length === 0 && listExtras.length === 0 && listRecords.length === 0;

  // Плитка — фильтр: повторный тап снимает выбор и возвращает план дня.
  const pick = (next: DayView) => {
    haptics.tap();
    setView((current) => (current === next ? "all" : next));
  };

  // Статус записи в плане дня: оплачено · долг · ожидается.
  const recordStatus = (a: Appointment): { word: string; amount: number; color: string } => {
    const debt = getDebtAmount(a);
    if (debt <= 0) return { word: "оплачено", amount: getPaidAmount(a), color: t.success };
    if (debtRecords.some((d) => d.id === a.id)) return { word: "долг", amount: debt, color: t.warning };
    return { word: "ожидается", amount: debt, color: t.sub };
  };

  const cta: { label: string; onPress: () => void } =
    view === "income"
      ? { label: "Добавить доход", onPress: () => openOperation(null, "income") }
      : view === "expense"
        ? { label: "Добавить расход", onPress: () => openOperation(null, "expense") }
        : // План дня, «Долг» и «Ожидается» — общая операция.
          { label: "Добавить операцию", onPress: () => openOperation(null, "expense") };

  const closing = dateYmd == null;

  return (
    <>
      <BottomSheet
        visible={dateYmd != null}
        onClose={onClose}
        // Имя листа, а не дата: день назван тем, по чему тапнули (владелец:
        // «даты сверху не надо»); шапка держит жест закрытия и заголовок для
        // VoiceOver, как у всех листов с кнопкой.
        title="Финансы дня"
        padded={false}
        scroll
        // Шторка встаёт на 50–75 % экрана: содержимое держит минимум высоты,
        // список длиннее — прокручивается внутри.
        maxHeightRatio={0.75}
        onExited={() => {
          const run = afterExit.current;
          afterExit.current = null;
          run?.();
        }}
        footer={
          <View
            pointerEvents={closing ? "none" : "auto"}
            style={{ paddingHorizontal: 16, paddingTop: 8 }}
          >
            <GradientButton label={cta.label} onPress={cta.onPress} />
          </View>
        }
      >
        <View
          pointerEvents={closing ? "none" : "auto"}
          style={{
            backgroundColor: t.canvas,
            paddingBottom: 12,
            minHeight: Math.round(screenH * 0.55),
          }}
        >
          {/* ЧЕТЫРЕ ПЛИТКИ — ТЕ ЖЕ, ЧТО НА «ФИНАНСАХ» (SummaryToggle): цвет
              несёт смысл, тинт — только у выбранной. Пока срез дня в пути,
              цифры гаснут, как гаснет сводка «Финансов» при смене периода. */}
          <View
            style={{
              paddingHorizontal: 16,
              paddingTop: 12,
              gap: 6,
              opacity: listLoading ? 0.4 : 1,
            }}
          >
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

          {/* Пусто — ничего: плитка уже сказала «€0», кнопка внизу — что
              делать. Только загрузка движется, иначе «грузится» и «пусто»
              были бы неотличимы. */}
          {listLoading ? (
            <EmptyState state="loading" />
          ) : listEmpty ? null : (
            <RowGroup title={humanDay(ymd)}>
              {view === "all"
                ? dayPlan.map((item, i) =>
                    item.record ? (
                      <RecordRow
                        key={item.key}
                        name={clientName(item.record)}
                        context={[item.record.time_start, servicesOf(item.record)]
                          .filter(Boolean)
                          .join(" · ")}
                        amount={recordStatus(item.record).amount}
                        color={recordStatus(item.record).color}
                        status={recordStatus(item.record).word}
                        separated={i > 0}
                        onPress={() => openRecord(item.record!.id)}
                      />
                    ) : item.tx ? (
                      <TxRow
                        key={item.key}
                        context={rowContext(item.tx)}
                        title={rowTitle(item.tx)}
                        amount={item.tx.amount}
                        outflow={item.tx.type === "expense" || item.tx.type === "refund"}
                        separated={i > 0}
                        onPress={rowAction(item.tx)}
                      />
                    ) : null,
                  )
                : null}
              {listRecords.map((a, i) => (
                <RecordRow
                  key={a.id}
                  name={clientName(a)}
                  context={[a.time_start, servicesOf(a)].filter(Boolean).join(" · ")}
                  amount={view === "debt" ? getDebtAmount(a) : a.total_amount}
                  color={view === "debt" ? t.warning : t.sub}
                  separated={i > 0}
                  onPress={() => openRecord(a.id)}
                />
              ))}
              {listTx.map((tx, i) => (
                <TxRow
                  key={tx.id}
                  context={rowContext(tx)}
                  title={rowTitle(tx)}
                  amount={tx.amount}
                  outflow={tx.type === "expense" || tx.type === "refund"}
                  separated={i > 0}
                  onPress={rowAction(tx)}
                />
              ))}
              {listExtras.map((e, i) => (
                <TxRow
                  key={e.id}
                  context="Ручная операция"
                  title={e.name}
                  amount={e.amount}
                  outflow={e.kind === "expense"}
                  separated={i > 0 || listTx.length > 0 || (view === "all" && dayPlan.length > 0)}
                  onRemove={teamId ? () => askRemoveLegacy(e) : undefined}
                />
              ))}
            </RowGroup>
          )}
        </View>
      </BottomSheet>

      <OperationSheet
        visible={opOpen}
        onClose={() => setOpOpen(false)}
        onExited={() => {
          if (shownYmd) onReopen?.(shownYmd);
        }}
        defaultTeamId={teamId}
        defaultType={opType}
        defaultDate={shownYmd}
        businessToday={businessToday}
        transaction={editingTx}
      />
    </>
  );
}

/** Строка операции — грамматика ленты «Финансов»: пилюля цвета знака,
 *  контекст над названием, сумма справа. */
function TxRow({
  context,
  title,
  amount,
  outflow,
  separated,
  onPress,
  onRemove,
}: {
  context: string;
  title: string;
  amount: number;
  outflow: boolean;
  separated?: boolean;
  onPress?: () => void;
  onRemove?: () => void;
}) {
  const t = useThemeColors();
  const color = outflow ? t.danger : t.success;
  const money = `${outflow ? "−" : ""}${formatEUR(Math.abs(amount))}`;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={`${title}, ${outflow ? "списание" : "поступление"} ${formatEUR(Math.abs(amount))}`}
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
      <View style={{ width: 6, height: 36, borderRadius: 999, backgroundColor: color }} />
      <View style={{ flex: 1 }}>
        {context ? (
          <Text numberOfLines={1} style={{ fontSize: 12, color: t.faint }}>
            {context}
          </Text>
        ) : null}
        <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: "600", color: t.ink }}>
          {title}
        </Text>
      </View>
      <Text style={{ fontSize: 16, fontWeight: "700", color, fontVariant: ["tabular-nums"] }}>
        {money}
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

/** Строка записи (долг, план) — грамматика списка должников: имя сверху,
 *  время и работа под ним, сумма справа. Долг — не транзакция, пилюли нет. */
function RecordRow({
  name,
  context,
  amount,
  color,
  status,
  separated,
  onPress,
}: {
  name: string;
  context: string;
  amount: number;
  color: string;
  /** «оплачено» · «долг» · «ожидается» — словом под суммой, в плане дня. */
  status?: string;
  separated?: boolean;
  onPress: () => void;
}) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${status ? `${status} ` : ""}${formatEUR(amount)} — открыть запись`}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        minHeight: 56,
        paddingHorizontal: 16,
        borderTopWidth: separated ? 1 : 0,
        borderTopColor: t.separator,
        backgroundColor: pressed ? t.pressed : "transparent",
      })}
    >
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: "500", color: t.ink }}>
          {name}
        </Text>
        {context ? (
          <Text numberOfLines={1} style={{ fontSize: 12, color: t.faint }}>
            {context}
          </Text>
        ) : null}
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={{ fontSize: 15, fontWeight: "700", color, fontVariant: ["tabular-nums"] }}>
          {formatEUR(amount)}
        </Text>
        {status ? (
          <Text style={{ fontSize: 12, color: t.faint }}>{status}</Text>
        ) : null}
      </View>
    </Pressable>
  );
}
