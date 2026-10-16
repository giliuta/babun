import { useBookingBlocks } from "@/features/appointments/booking-prefs";
import { useRecordBlocks } from "@/features/appointments/useRecordRights";
import { Text, useWindowDimensions, View } from "react-native";
import { useRouter } from "expo-router";
import type { Appointment } from "@babun/shared/local/appointments";
import { getDebtAmount, getPaidAmount } from "@babun/shared/local/appointments";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { GradientButton } from "@/components/ui/GradientButton";
import {
  useDayExtras,
  useFinanceServices,
  useSetDayExtras,
} from "@/features/calendar/queries";
import { useClients } from "@/features/clients/queries";
import { OperationSheet } from "@/features/finances/OperationSheet";
import { useFinanceCategories } from "@/features/finances/queries";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";
import { accessGate, moneyKey } from "@/session/my-access";
import { dayMoneyGate } from "@/features/calendar/day-money-access";
import { useMyAccess } from "@/session/access-queries";
import { useCurrentRole } from "@/session/tenant";
import { useSession } from "@/providers/SessionProvider";
import { AccountSplit } from "./day-finance/AccountSplit";
import { dayList } from "./day-finance/day-list";
import { DayList } from "./day-finance/DayList";
import { DayTiles } from "./day-finance/DayTiles";
import type { DayView } from "./day-finance/types";
import { useDayAccounts } from "./day-finance/use-day-accounts";
import { useDayFinanceActions } from "./day-finance/use-day-finance-actions";
import { useDayLedger } from "./day-finance/use-day-ledger";

// ФИНАНСЫ ДНЯ — ЛИСТ СНИЗУ С ПЛИТКАМИ КАК В «ФИНАНСАХ»: сверху четыре плитки (доход и расход в
// верхнем ряду, долг и серый «ожидается» в нижнем), шторка на 50–75 % экрана,
// чтобы вошли все операции дня, даты сверху нет, внизу синяя кнопка, которая
// меняется по плитке; пустой список — просто пусто.
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
// КНОПКА ВНИЗУ — ВСЕГДА ОПЕРАЦИЯ ИЗ «ФИНАНСОВ» (это финансы в календаре — вся
// система из страницы финансов, а не из «создать запись»): «Добавить доход» и «Добавить расход» на своих плитках, иначе
// «Добавить операцию» — та же форма по категориям, что на вкладке. День
// подставляется в форму; будущий день леджер не принимает, поэтому форма
// открывается на сегодняшней дате и показывает её в строке «Дата».
//
// Операция отсюда помечена «из календаря» (`fromCalendar`; из календаря в «Финансы» операция
// переносится, обратно — нет): она есть и в «Финансах», а день календаря
// считает только оплаты записей и такие операции.
//
// Старые «ручные операции дня» (day_extras) показываются и удаляются с
// вопросом; новых не заводится — деньги живут в одном леджере.
//
// Parts live in `day-finance/`: the day's ledger (`use-day-ledger`), the
// per-account split, row actions, the tiles and the list.

export function DayFinanceSheet({
  dateYmd,
  appointments,
  teamId,
  businessToday,
  nowHm: nowHmProp,
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
  /** «Сейчас» по времени бизнеса (HH:MM) — пара к `businessToday`: долг дня
   *  считается по тем же часам, что сетка. Нет — часы телефона. */
  nowHm?: string;
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
  // Блок «Оплата» — из «Дизайна» этой команды.
  const paymentOn = useBookingBlocks(teamId).includes("payment");
  // Оплату записей сотрудник может не видеть («Оплата: Скрыта»): сервер шлёт
  // нули, и «Долг» складывал бы суммы всех прошедших визитов, а строка плана —
  // «долг» у каждого. Владельцу — всегда «видит».
  const paymentSeen = useRecordBlocks(teamId).payment !== "hidden";
  const router = useRouter();
  const { height: screenH, width: screenW } = useWindowDimensions();
  const services = useFinanceServices();
  const { data: extrasMap = {} } = useDayExtras();
  const { data: clients = [] } = useClients();
  const { data: categories = [] } = useFinanceCategories();
  const setExtras = useSetDayExtras();
  // «ВИДИТ» — ЛИСТ ТОТ ЖЕ, ИЗМЕНЕНИЯ ЗАКРЫТЫ (кнопка на месте, серая,
  // причина словами). Открывает их право календаря «Доход и расход дня»
  // (`day-money-access.ts`), а не доходы и расходы «Финансов»:
  // «Вносит» — доход и расход этого дня в ЭТОМ календаре; сервер проверяет
  // то же (`finance_transactions_insert_day_money`), так что серое не врёт.
  const role = useCurrentRole().data;
  const myAccess = useMyAccess().data;
  const me = useSession().session?.user.id ?? null;
  const canWriteDayMoney = dayMoneyGate({ role, map: myAccess, teamId }) === "write";
  const canWriteIncome = canWriteDayMoney;
  const canWriteExpense = canWriteDayMoney;
  /** Старые «ручные операции дня» (day_extras): их сервер правит по сторонам
   *  «Финансов» (`replace_day_extras`), новых не заводится. */
  const writesLegacySide = (side: "income" | "expense") =>
    accessGate({ role, map: myAccess, blockKey: moneyKey(myAccess, side), scope: "calendar", teamId }) === "write";
  const {
    view,
    setView,
    shownYmd,
    ymd,
    ledgerLoading,
    legacyExtras,
    money,
    incomeRows,
    expenseRows,
    debtRecords,
    plannedRecords,
    apptById,
    recordOf,
    nameById,
    categoryName,
    dayPlan,
  } = useDayLedger({
    dateYmd,
    appointments,
    teamId,
    businessToday,
    nowHmProp,
    findRecord,
    role,
    myAccess,
    services,
    extrasMap,
    clients,
    categories,
  });

  const { accountById, accountPick, setAccountPick, split, splitTileW } = useDayAccounts({
    shownYmd,
    teamId,
    view,
    incomeRows,
    expenseRows,
    screenW,
  });

  const clientName = (a: Appointment) =>
    (a.client_id ? nameById.get(a.client_id) : null) || a.comment?.trim() || "Без имени";
  const servicesOf = (a: Appointment) =>
    (a.services ?? []).map((s) => s.serviceName).filter(Boolean).join(", ");

  const {
    opOpen,
    setOpOpen,
    editingTx,
    opType,
    afterExit,
    openOperation,
    openRecord,
    askRemoveLegacy,
    rowTitle,
    rowContext,
    rowAction,
    swipeTx,
  } = useDayFinanceActions({
    onClose,
    onEditAppointment,
    findRecord,
    router,
    teamId,
    shownYmd,
    ymd,
    legacyExtras,
    setExtras,
    apptById,
    recordOf,
    servicesOf,
    nameById,
    categoryName,
    role,
    myAccess,
    me,
  });

  const { listExtras, listTx, listRecords, listLoading, listEmpty } = dayList({
    view,
    legacyExtras,
    incomeRows,
    expenseRows,
    accountPick,
    plannedRecords,
    debtRecords,
    ledgerLoading,
    dayPlanSize: dayPlan.length,
  });

  // Плитка — фильтр: повторный тап снимает выбор и возвращает план дня.
  const pick = (next: DayView) => {
    haptics.tap();
    setView((current) => (current === next ? "all" : next));
  };

  // Статус записи в плане дня: оплачено · долг · ожидается.
  const recordStatus = (a: Appointment): { word: string; amount: number; color: string } => {
    if (!paymentSeen) return { word: "сумма", amount: Number(a.total_amount) || 0, color: t.sub };
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
        // Имя листа, а не дата: день назван тем, по чему тапнули (даты сверху нет); шапка держит жест закрытия и заголовок для
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
          <DayTiles
            money={money}
            view={view}
            pick={pick}
            listLoading={listLoading}
            showDebt={paymentOn && paymentSeen}
          />

          {(view === "income" || view === "expense") && !listLoading && split.length > 0 ? (
            <AccountSplit
              view={view}
              split={split}
              accountById={accountById}
              accountPick={accountPick}
              setAccountPick={setAccountPick}
              splitTileW={splitTileW}
            />
          ) : null}

          <DayList
            ymd={ymd}
            view={view}
            teamId={teamId}
            listLoading={listLoading}
            listEmpty={listEmpty}
            dayPlan={dayPlan}
            listRecords={listRecords}
            listTx={listTx}
            listExtras={listExtras}
            clientName={clientName}
            servicesOf={servicesOf}
            recordStatus={recordStatus}
            openRecord={openRecord}
            swipeTx={swipeTx}
            rowContext={rowContext}
            rowTitle={rowTitle}
            rowAction={rowAction}
            writesLegacySide={writesLegacySide}
            askRemoveLegacy={askRemoveLegacy}
          />
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
        fromCalendar
      />
    </>
  );
}
