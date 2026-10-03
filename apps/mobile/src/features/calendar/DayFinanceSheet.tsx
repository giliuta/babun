import { useBookingBlocks } from "@/features/appointments/booking-prefs";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, useWindowDimensions, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import type { Appointment } from "@babun/shared/local/appointments";
import { getDebtAmount, getPaidAmount } from "@babun/shared/local/appointments";
import {
  formatEURExact as formatEUR,
  moneySign,
} from "@babun/shared/common/utils/money";
import { listAccounts } from "@babun/shared/db/repositories/accounts";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import { canEditTransaction } from "@babun/shared/local/finance/transaction";
import type { DayExtra } from "@babun/shared/local/day-extras";
import { getDayExtras } from "@babun/shared/local/day-extras";
import { Wallet } from "lucide-react-native";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { RowGroup, RowGroupHeader } from "@/components/ui/card-rows";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { EmptyState } from "@/components/ui/EmptyState";
import { GradientButton } from "@/components/ui/GradientButton";
import { PaymentTile, TILE_GAP } from "@/features/appointments/PaymentTiles";
import { formatHM, humanDay, humanDayYear } from "@/features/appointments/helpers";
import { dayMoney, moneyByAccount } from "@/features/calendar/day-money";
import {
  useDayExtras,
  useFinanceServices,
  useSetDayExtras,
} from "@/features/calendar/queries";
import { useClients } from "@/features/clients/queries";
import { accountIcon } from "@/features/finances/account-ui";
import { SummaryToggle } from "@/features/finances/FinanceOverview";
import { OperationSheet } from "@/features/finances/OperationSheet";
import { accountRowsQueryKey } from "@/lib/company-query-keys";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import {
  useAppointmentsLedger,
  useFinanceCategories,
  useTransactions,
} from "@/features/finances/queries";
import { confirmThen } from "@/lib/confirm";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";
import { accessGate, canEditMoneyRow, moneyKey } from "@/features/access/my-access";
import { useMyAccess } from "@/features/access/queries";
import { useCurrentRole } from "@/features/settings/tenant";
import { useSession } from "@/providers/SessionProvider";

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
  findRecord,
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
  /** Запись другого дня по id — у предоплаты за завтра имя и дата записи
   *  берутся отсюда (записи дня её не знают). */
  findRecord?: (id: string) => Appointment | undefined;
}) {
  const t = useThemeColors();
  // Блок «Оплата» — из «Дизайна» этой команды (24.09).
  const paymentOn = useBookingBlocks(teamId).includes("payment");
  const router = useRouter();
  const { height: screenH, width: screenW } = useWindowDimensions();
  const services = useFinanceServices();
  const { data: extrasMap = {} } = useDayExtras();
  const { data: clients = [] } = useClients();
  const { data: categories = [] } = useFinanceCategories();
  const setExtras = useSetDayExtras();
  // «СМОТРИТ» — ЛИСТ ТОТ ЖЕ, ИЗМЕНЕНИЯ ЗАКРЫТЫ (этап 2 доступа; план: кнопка
  // на месте, серая, причина словами). С среза 2а доходы и расходы — два
  // права: кнопка и строки открыты по своей стороне денег в ЭТОМ календаре;
  // сервер проверяет то же, так что серое не врёт.
  const role = useCurrentRole().data;
  const myAccess = useMyAccess().data;
  const me = useSession().session?.user.id ?? null;
  const writesSide = (side: "income" | "expense") =>
    accessGate({ role, map: myAccess, blockKey: moneyKey(myAccess, side), scope: "calendar", teamId }) === "write";
  const canWriteIncome = writesSide("income");
  const canWriteExpense = writesSide("expense");
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
  // Операции записей дня — в любой день внесения: предоплата за запись
  // стоит в дне записи (владелец 2026-10-01, правило в `day-money.ts`).
  const recordsTxQuery = useAppointmentsLedger(
    useMemo(() => appts.map((a) => a.id), [appts]),
    { enabled: shownYmd != null },
  );
  // Обе выборки вместе; к дню строки относит `dayMoney` — и прошлый день,
  // подсунутый keepPreviousData, туда не попадёт.
  const dayTx = useMemo(
    () => [...(txQuery.data ?? []), ...(recordsTxQuery.data ?? [])],
    [txQuery.data, recordsTxQuery.data],
  );
  const ledgerLoading =
    (txQuery.isPending && txQuery.data === undefined) ||
    txQuery.isPlaceholderData ||
    recordsTxQuery.isPlaceholderData;

  const legacyExtras = useMemo(
    () => (shownYmd ? getDayExtras(extrasMap, teamId, shownYmd) : []),
    [extrasMap, teamId, shownYmd],
  );
  // ДЕНЬГИ ДНЯ — ТЕМ ЖЕ ПРАВИЛОМ, ЧТО ПОЛОСА ПОД СЕТКОЙ (`day-money.ts`):
  // деньги записи — в дне записи, операция без записи — в своём дне, события —
  // не деньги.
  const money = useMemo(
    () =>
      dayMoney({
        ymd,
        appointments: appts,
        transactions: dayTx,
        services,
        teamId,
        extras: legacyExtras,
        businessToday,
        nowHm,
      }),
    [ymd, appts, dayTx, services, teamId, legacyExtras, businessToday, nowHm],
  );
  const { incomeRows, expenseRows, debtRecords, plannedRecords } = money;

  const apptById = useMemo(
    () => new Map(money.records.map((a) => [a.id, a])),
    [money.records],
  );
  /** Запись строки леджера: своего дня — из записей дня, чужого — у экрана. */
  const recordOf = (tx: FinanceTransaction): Appointment | undefined =>
    tx.appointment_id
      ? apptById.get(tx.appointment_id) ?? findRecord?.(tx.appointment_id)
      : undefined;
  const nameById = useMemo(
    () => new Map(clients.map((c) => [c.id, c.full_name])),
    [clients],
  );
  const categoryName = useMemo(
    () => new Map(categories.map((c) => [c.id, c.name])),
    [categories],
  );

  // ПЛАН ДНЯ — всё по времени: записи дня (оплачено · долг · ожидается) и
  // операции, которых запись дня не показывает: ручные и оплаты ДРУГИХ дней
  // (предоплата сегодня за завтра — сегодняшние деньги). Оплата записи этого
  // дня не дублирует саму запись.
  const timeOfTx = (tx: FinanceTransaction): string =>
    (tx.appointment_id ? apptById.get(tx.appointment_id)?.time_start : null) ||
    tx.occurred_time ||
    "24:00";
  const dayPlan = useMemo(() => {
    const items: { key: string; time: string; record?: Appointment; tx?: FinanceTransaction }[] = [];
    for (const a of money.records) {
      items.push({ key: `a:${a.id}`, time: a.time_start, record: a });
    }
    for (const tx of incomeRows) {
      if (tx.appointment_id && apptById.has(tx.appointment_id)) continue;
      items.push({ key: `t:${tx.id}`, time: timeOfTx(tx), tx });
    }
    for (const tx of expenseRows) {
      if (tx.appointment_id && apptById.has(tx.appointment_id) && !tx.id.startsWith("material:")) continue;
      items.push({ key: `t:${tx.id}`, time: timeOfTx(tx), tx });
    }
    return items.sort((x, y) => x.time.localeCompare(y.time));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- timeOfTx читает apptById, он в зависимостях
  }, [money.records, incomeRows, expenseRows, apptById]);

  // ПО СЧЕТАМ (владелец 2026-09-30: «открываю доход — сколько зашло на каждый
  // счёт: на наличку, на карту… на те счета, которые я создал»). Плитки
  // счетов команды в порядке страницы «Счета»; тап — список только этого
  // счёта, повторный — снова все.
  const tenantId = useTenantId();
  const accountsQuery = useQuery({
    queryKey: accountRowsQueryKey(tenantId, true),
    enabled: !!tenantId && shownYmd != null,
    staleTime: 60_000,
    queryFn: () => listAccounts(supabase, tenantId as string, { includeInactive: true }),
  });
  const accountById = useMemo(
    () => new Map((accountsQuery.data ?? []).map((a) => [a.id, a])),
    [accountsQuery.data],
  );
  const accountOrder = useMemo(
    () =>
      (accountsQuery.data ?? [])
        .filter((a) => a.is_active && (!teamId || a.brigade_id === teamId))
        .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
        .map((a) => a.id),
    [accountsQuery.data, teamId],
  );
  const [accountPick, setAccountPick] = useState<string | null | undefined>(undefined);
  useEffect(() => setAccountPick(undefined), [view, shownYmd]);
  const split = useMemo(() => {
    const rows = view === "income" ? incomeRows : view === "expense" ? expenseRows : [];
    return rows.length > 0 || accountOrder.length > 0 ? moneyByAccount(rows, accountOrder) : [];
  }, [view, incomeRows, expenseRows, accountOrder]);
  const splitTileW = Math.floor((screenW - 32 - TILE_GAP * 2) / 3);

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
    const known = apptById.get(appointmentId) ?? findRecord?.(appointmentId);
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
    const appt = recordOf(tx);
    const names = appt ? servicesOf(appt) : "";
    const cat = tx.category_id ? categoryName.get(tx.category_id) : null;
    if (tx.type === "income" || tx.type === "refund") {
      return names || tx.notes || cat || (tx.type === "refund" ? "Возврат" : "Поступление");
    }
    return cat || tx.notes || "Расход";
  };
  const rowContext = (tx: FinanceTransaction): string => {
    const appt = recordOf(tx);
    // Оплата записи ДРУГОГО дня (предоплата за завтра): время — её, а не
    // записи, и день записи словами — иначе строка выглядит визитом сегодня.
    const foreign = appt && appt.date !== ymd ? appt : null;
    const time = (foreign ? null : appt?.time_start) || tx.occurred_time || "";
    if (tx.type === "income" || tx.type === "refund") {
      const who = tx.client_id ? nameById.get(tx.client_id) ?? "" : "";
      const forDay = foreign
        ? `${tx.appointment_payment_kind === "prepayment" ? "предоплата" : "оплата"} за ${humanDay(foreign.date).replace(/^\S+ /, "")}`
        : "";
      return [time, who, forDay].filter(Boolean).join(" · ");
    }
    const cat = tx.category_id ? categoryName.get(tx.category_id) : null;
    return [time, cat && tx.notes ? tx.notes : ""].filter(Boolean).join(" · ");
  };
  const rowAction = (tx: FinanceTransaction): (() => void) | undefined => {
    if (tx.appointment_id) {
      const id = tx.appointment_id;
      return () => openRecord(id);
    }
    // Сотрудник правит операцию своей стороны денег (срез 2а): «Правит всё» —
    // любую строку команды, «Добавляет» — свою; оплату долга ведёт экран
    // долгов. Сервер отказывает ровно так же — двери, которая кончится
    // отказом, нет (правило 10).
    const side = tx.type === "expense" ? "expense" : "income";
    if (
      canEditTransaction(tx) &&
      (role === "owner" || !tx.debt_id) &&
      canEditMoneyRow({ role, map: myAccess, teamId: tx.team_id ?? teamId, side, createdBy: tx.created_by, me })
    ) {
      return () => openOperation(tx, side);
    }
    return undefined;
  };

  const listExtras: DayExtra[] =
    view === "income" || view === "expense"
      ? legacyExtras.filter((e) => e.kind === view)
      : view === "all"
        ? legacyExtras
        : [];
  const sideRows = view === "income" ? incomeRows : view === "expense" ? expenseRows : [];
  // Выбран счёт — только его строки (материалы счёта не имеют и уходят).
  const listTx =
    accountPick === undefined
      ? sideRows
      : sideRows.filter(
          (tx) => !tx.id.startsWith("material:") && (tx.account_id ?? null) === accountPick,
        );
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

  const cta: { label: string; onPress: () => void; open: boolean } =
    view === "income"
      ? { label: "Добавить доход", onPress: () => openOperation(null, "income"), open: canWriteIncome }
      : view === "expense"
        ? { label: "Добавить расход", onPress: () => openOperation(null, "expense"), open: canWriteExpense }
        : // План дня, «Долг» и «Ожидается» — общая операция: форма открывается
          // на той стороне, которую он пишет (расход, если пишет обе).
          {
            label: "Добавить операцию",
            onPress: () => openOperation(null, canWriteExpense ? "expense" : "income"),
            open: canWriteIncome || canWriteExpense,
          };

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
            style={{ paddingHorizontal: 16, paddingTop: 8, gap: 6 }}
          >
            {cta.open ? null : (
              <Text style={{ fontSize: 13, color: t.sub, textAlign: "center" }}>
                Только просмотр
              </Text>
            )}
            <GradientButton label={cta.label} onPress={cta.onPress} disabled={!cta.open} />
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
                color={moneySign(money.income) < 0 ? t.danger : t.success}
                value={formatEUR(money.income)}
                active={view === "income"}
                onPress={() => pick("income")}
              />
              <SummaryToggle
                label="Расход"
                color={t.danger}
                value={formatEUR(money.expense)}
                active={view === "expense"}
                onPress={() => pick("expense")}
              />
            </View>
            <View style={{ flexDirection: "row", gap: 6 }}>
              {/* Долг дня — неоплаченные записи. Без оплаты в записи
                  (функция компании выключена, STORY-088) все записи
                  выглядели бы долгом — плитки нет. */}
              {paymentOn ? (
                <SummaryToggle
                  label="Долг"
                  color={t.warning}
                  value={formatEUR(money.debt)}
                  active={view === "debt"}
                  onPress={() => pick("debt")}
                />
              ) : null}
              {/* Серым: план — не деньги, а то, что ещё предстоит. */}
              <SummaryToggle
                label="Ожидается"
                color={t.sub}
                value={formatEUR(money.planned)}
                active={view === "planned"}
                onPress={() => pick("planned")}
              />
            </View>
          </View>

          {/* ПО СЧЕТАМ — под «Доходом» и «Расходом»: сколько легло на каждый
              счёт команды за день, плиткой счёта, какой его узнают в оплате
              записи. Тап — строки только этого счёта. */}
          {(view === "income" || view === "expense") && !listLoading && split.length > 0 ? (
            <View style={{ paddingTop: 14 }}>
              <RowGroupHeader title="По счетам" />
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: TILE_GAP, paddingHorizontal: 16 }}>
                {split.map((entry) => {
                  const account = entry.accountId ? accountById.get(entry.accountId) : undefined;
                  const label = account?.name ?? "Без счёта";
                  const zero = entry.amount === 0;
                  const sign = view === "expense" && !zero ? "−" : "";
                  const selected = accountPick !== undefined && accountPick === entry.accountId;
                  return (
                    <PaymentTile
                      key={entry.accountId ?? "none"}
                      icon={account ? accountIcon(account) : Wallet}
                      label={label}
                      color={account?.color ?? t.ink}
                      tint={account?.color ?? null}
                      width={splitTileW}
                      compact
                      state="idle"
                      selected={selected}
                      amount={`${sign}${formatEUR(Math.abs(entry.amount))}`}
                      amountColor={zero ? t.faint : view === "expense" ? t.danger : t.success}
                      disabled={entry.count === 0}
                      onPress={() => {
                        haptics.tap();
                        setAccountPick((cur) => (cur === entry.accountId ? undefined : entry.accountId));
                      }}
                      accessibilityLabel={`${label}: ${view === "expense" ? "ушло" : "пришло"} ${formatEUR(Math.abs(entry.amount))}${selected ? ", выбран" : ""}`}
                    />
                  );
                })}
              </View>
            </View>
          ) : null}

          {/* Пусто — ничего: плитка уже сказала «€0», кнопка внизу — что
              делать. Только загрузка движется, иначе «грузится» и «пусто»
              были бы неотличимы. */}
          {listLoading ? (
            <EmptyState state="loading" />
          ) : listEmpty ? null : (
            <RowGroup title={humanDayYear(ymd)}>
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
                  // Остаток, а не итог — у обоих списков (аудит 2026-10-03):
                  // плитка «Ожидается» складывает остатки, и запись €100 с
                  // предоплатой €30 стояла строкой €100 под плиткой €70.
                  amount={getDebtAmount(a)}
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
              {listExtras.map((e, i) => {
                const row = (
                  <TxRow
                    context="Ручная операция"
                    title={e.name}
                    amount={e.amount}
                    outflow={e.kind === "expense"}
                    separated={i > 0 || listTx.length > 0 || (view === "all" && dayPlan.length > 0)}
                  />
                );
                // УДАЛЕНИЕ — СВАЙПОМ, ПРАВОЙ КРОМКОЙ (канон 9, аудит 24.09):
                // крестик в строке был четвёртым способом удалить что-то в
                // продукте и мишенью 36pt рядом с суммой.
                // Стирает строку своей стороны: сервер пишет только её, а чужую
                // сторону дня оставляет как была (срез 2а).
                return teamId && (e.kind === "income" ? canWriteIncome : canWriteExpense) ? (
                  <SwipeRow
                    key={e.id}
                    label="Удалить"
                    color={t.danger}
                    onAction={() => askRemoveLegacy(e)}
                    accessibilityLabel={`Удалить «${e.name}»`}
                  >
                    {row}
                  </SwipeRow>
                ) : (
                  <View key={e.id}>{row}</View>
                );
              })}
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
}: {
  context: string;
  title: string;
  amount: number;
  outflow: boolean;
  separated?: boolean;
  onPress?: () => void;
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
        paddingRight: 16,
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
