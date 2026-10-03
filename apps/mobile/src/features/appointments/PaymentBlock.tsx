import { useFeatureOn } from "@/features/settings/company-features";
import { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { FileText, History, Split } from "lucide-react-native";
import type {
  Appointment,
  AppointmentStatus,
} from "@babun/shared/local/appointments";
import { randomUuid } from "@babun/shared/sync";
import { formatEURExact, moneySymbol } from "@babun/shared/common/utils/money";
import { usePaymentRights } from "./usePaymentRights";
import { SectionCard } from "@/components/ui/SectionCard";
import { useToast } from "@/components/ui/Toast";
import { chooseOption } from "@/lib/choose";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";
import { accountIcon } from "@/features/finances/account-ui";
import { PaymentHistorySheet } from "@/features/finances/PaymentHistorySheet";
import { AccountEditorSheet } from "@/features/finances/account-editor/AccountEditorSheet";
import { useCreditNoteLinks, useInvoices } from "@/features/invoices/queries";
import { liveAppointmentInvoices } from "@/features/invoices/appointment-invoices";
import { usePlanAllows, useTenant } from "@/features/settings/tenant";
import { useBusinessNow } from "./business-now";
import {
  useTeamPaymentAccounts,
  type PaymentAccountOption,
} from "./payment-accounts";
import {
  amountCentsFromInput,
  amountProblem,
  blockCaption,
  closesVisit,
  paidAtLabel,
  paidTileIntent,
  paymentKindAt,
  paymentMath,
  paymentRows,
  recordedToast,
  visitStarted,
  type PaymentKind,
  type PaymentRow,
} from "./payment-draft";
import { useCancelPayment, useRecordPayment } from "./payment-mutations";
import { optimisticCancelPayment, optimisticRecordPayment } from "./payment-optimistic";
import {
  ModeIconButton,
  NoAccountsNotice,
  PaymentStateRow,
  PaymentTile,
  TILE_GAP,
  useTileWidth,
} from "./PaymentTiles";
import { useTariffNudge } from "@/features/tariffs/use-tariff";

// БЛОК «ОПЛАТА» (STORY-065). Тап по счёту — деньги получены и записаны СРАЗУ
// (владелец 2026-09-06: без черновика); визит закрывается, если начался.
// ОДНА кнопка суммы (стрелки врозь — «распределение», владелец) и для предоплаты, и для части: «это одна и та же
// функция — какая разница, столько-то или столько-то» (владелец). Плитка
// принимает деньги В ЛЮБОЙ МОМЕНТ (владелец 2026-09-24: «когда угодно могу
// нажать наличку — и оно будет оплачено, не обязательно, чтоб заканчивалось
// время»): до начала визита тап записывает всю сумму предоплатой, и запись
// оплачена заранее; после начала — оплатой. Раньше до начала плитки были
// погашены и отвечали «визит ещё не начался», и оплата у клиента «не
// записывалась». Введённая сумма — часть, остаток остаётся долгом или уходит
// на вторую плитку. Зелёная плитка при ОТКРЫТОМ поле прибавляет на тот же счёт
// (владелец: «оно должно плюсануть, а не снимать»): плитка одна на счёт, с
// суммой всех его платежей. Ошибочный платёж снимает тап по зелёной плитке без
// поля или «Снять» в тосте — сервер пишет сторно «деньги не поступили», не
// возврат. Деньги ждут кнопки только у новой записи: уходят с «Создать запись».

/** Права на оплату записи у этого человека в этом календаре нет: сервер
 *  откажет, поэтому плитки гаснут заранее и называют причину. */
const NO_PAYMENT_RIGHT = "Принимать оплату в этом календаре вам не разрешили";

export interface PendingPayment {
  accountId: string;
  /** Евро с копейками. */
  amount: number;
  kind: PaymentKind;
  /** Тап без поля суммы — «вся сумма»: при создании берётся итог формы на
   *  тот момент (`pendingPaymentToSend`), а не число с момента тапа. */
  full: boolean;
}

export interface PaymentBlockProps {
  /** Сохранённая запись (правка) или null (создание): деньги — только по ней. */
  appointment: Appointment | null;
  teamId: string | null;
  /** Итог формы — сумма к оплате у ещё не созданной записи. */
  totalDraft: number;
  /** Дата, начало и статус из формы — правило «визит начался». */
  visit: { date: string; timeStart: string; status: AppointmentStatus };
  pending: PendingPayment | null;
  onPendingChange: (next: PendingPayment | null) => void;
  /** Свежая запись после оплаты/снятия — страница подтягивает статус. */
  onAppointmentChanged: (fresh: Appointment) => void;
  /** Клиент в форме. Расходится с сохранённым — деньги не принимаем, пока
   *  запись не сохранена: платёж лёг бы на прежнего клиента. */
  clientId?: string | null;
}


export function PaymentBlock({
  appointment,
  teamId,
  totalDraft,
  visit,
  pending,
  onPendingChange,
  onAppointmentChanged,
  clientId,
}: PaymentBlockProps) {
  const t = useThemeColors();
  const router = useRouter();
  const documentsOn = useFeatureOn("documents");
  const toast = useToast();
  const currency = useTenant().data?.currency;
  const businessNow = useBusinessNow();
  const tileWidth = useTileWidth();
  const {
    data: accounts = [],
    isSuccess: accountsLoaded,
    // Счётчик ошибок, а не `isError`: на повторе react-query возвращает
    // ни разу не загруженный запрос в «pending», и слова мигали бы.
    errorUpdateCount: accountsFailures,
  } = useTeamPaymentAccounts(teamId);
  // Одна очередь на деньги записи: «Снять» в тосте ждёт ответа оплаты.
  // СМЕНИЛИ КОМАНДУ — ОТМЕЧЕННЫЙ СЧЁТ УХОДИТ. У новой записи плитка лишь
  // отмечает счёт; счёт прежней команды сервер отобьёт («Этот счёт не
  // принимает оплату…»), и запись создастся без денег (аудит 2026-10-03).
  useEffect(() => {
    if (pending && accountsLoaded && !accounts.some((a) => a.id === pending.accountId)) {
      onPendingChange(null);
    }
  }, [pending, accountsLoaded, accounts, onPendingChange]);
  const record = useRecordPayment(appointment?.id);
  const cancel = useCancelPayment(appointment?.id);
  const invoicesQuery = useInvoices();
  const creditLinks = useCreditNoteLinks();
  const [partText, setPartText] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  // СЧЁТ ЗАВОДИТ ТОТ, КТО МЕНЯЕТ СЧЕТА В ЭТОМ КАЛЕНДАРЕ (уровни финансов,
  // 2026-09-15). Раньше дверь была только у владельца: политика счетов не
  // знала уровней, и «Заведите счёт» сотруднику заканчивалось отказом.
  // Все три права блока — одним расчётом (`payment-rights.ts`, с тестом).
  const {
    createAccount: canCreateAccount,
    seeHistory: canSeeHistory,
    takeMoney: canTakeMoney,
  } = usePaymentRights(teamId);
  const canUseDocuments = usePlanAllows("documents");
  // БЕЗ ТАРИФА ЗАПИСИ КЛИЕНТОВ — ТОЛЬКО ДЛЯ ПРОСМОТРА (владелец 2.10: «люди 14
  // дней бесплатно насоздают клиентов, потом будут переносить»). Сервер
  // отказывает в правке записи (`plan:book-clients`); здесь плитки и «Часть
  // суммы» серые, а тап поднимает плашку «Нужно изменить тариф» вместо
  // отказа после поездки на сервер. Полученные деньги видны как были.
  const bookingInPlan = usePlanAllows("book-clients");
  const tariffNudge = useTariffNudge();

  const invoice = useMemo(
    () =>
      liveAppointmentInvoices(
        invoicesQuery.data ?? [],
        appointment?.id,
        creditLinks.data?.originalByNoteId ?? new Map(),
      )[0] ?? null,
    [appointment?.id, invoicesQuery.data, creditLinks.data],
  );

  const started = visitStarted(
    { date: visit.date, time_start: visit.timeStart },
    businessNow(),
  );
  // СЧИТАЕМ ПО ИТОГУ ФОРМЫ. У сохранённой записи итог в базе — прошлая версия:
  // человек дописал услуги, «Итого» стало €280, а блок ещё жил числом 160 и
  // объявлял запись оплаченной. Правило и его причина — в `paymentMath`.
  const { outstanding, overpaid } = paymentMath(appointment, totalDraft);
  // Итог формы разошёлся с сохранённым: долг уже настоящий, а вот принять по
  // нему деньги сервер откажется — он считает остаток по своей строке. Пока
  // запись не сохранена, плитки стоят погашенными и говорят почему.
  const billUnsaved =
    appointment !== null
    && Math.round(appointment.total_amount * 100) !== Math.round(totalDraft * 100);
  const rows = useMemo(
    () => (appointment ? paymentRows(appointment) : []),
    [appointment],
  );
  const rowsByAccount = useMemo(() => {
    const map = new Map<string, PaymentRow[]>();
    for (const row of rows) {
      if (!row.accountId) continue;
      map.set(row.accountId, [...(map.get(row.accountId) ?? []), row]);
    }
    return map;
  }, [rows]);
  const unattributed = rows.filter((row) => !row.accountId);
  const busy = record.isPending || cancel.isPending;
  const amountMode = partText != null;
  // Вид платежа выводится из времени, а не выбирается: до начала — предоплата.
  // Запись, уже отмеченная выполненной или начатой, платит оплатой и до
  // своего часа: предоплату по выполненной сервер отбивает.
  const kindForTap: PaymentKind = paymentKindAt(
    { date: visit.date, time_start: visit.timeStart, status: visit.status },
    businessNow(),
  );
  const amountCents = amountMode ? amountCentsFromInput(partText) : outstanding;
  const problem = amountProblem(amountCents, outstanding);
  const clientUnsaved =
    appointment !== null &&
    clientId !== undefined &&
    (appointment.client_id ?? null) !== (clientId ?? null);
  // Отменённый визит денег не принимает — так решает сервер
  // (`record_appointment_payment`). Плитки гаснут заранее: тап рисовал
  // «оплачено» и через секунду откатывал с ошибкой (аудит 2026-10-03). Снять
  // уже принятое можно — это зелёная плитка.
  const visitCancelled =
    appointment !== null &&
    (appointment.status === "cancelled" || appointment.payment_status === "refunded");
  const acceptsMoney = outstanding > 0 && !billUnsaved && !clientUnsaved && !visitCancelled && canTakeMoney && bookingInPlan;

  // СНЯТИЕ И ПРИЁМ — ПО ТАПУ, А НЕ ПО ОТВЕТУ (владелец 2026-09-30: «должно
  // всё мгновенно»): запись в кэше меняется сразу так, как её поменяет
  // сервер (`payment-optimistic.ts`), отклик и слова — тоже сразу. Ответ
  // только подменяет строку канонической; отказ возвращает прежнюю и говорит
  // почему.
  const runCancel = (
    source: Appointment,
    paymentId: string,
    accountName: string,
    amount: number,
  ) => {
    const optimistic = optimisticCancelPayment(source, paymentId);
    haptics.success();
    onAppointmentChanged(optimistic);
    toast(`Оплата ${formatEURExact(amount)} снята · ${accountName}`, "info");
    // `mutateAsync`, а не `mutate` с откликами: ушёл со страницы — отклики
    // вызова у снятого наблюдателя молчат, и отказ сервера пропадал без слова
    // (аудит 2026-10-03). Обещание отвечает всегда — так же, как у оплаты
    // новой записи в `book/index.tsx`.
    cancel
      .mutateAsync({ appointmentId: source.id, paymentId, requestId: randomUuid(), optimistic })
      .then((fresh) => onAppointmentChanged(fresh))
      .catch((error: unknown) => {
        haptics.error();
        onAppointmentChanged(source);
        toast(error instanceof Error ? error.message : "Не удалось снять оплату", "error");
      });
  };

  const handleTileTap = (account: PaymentAccountOption) => {
    if (outstanding <= 0 || busy) return;
    if (!bookingInPlan) {
      tariffNudge();
      return;
    }
    if (!canTakeMoney) {
      haptics.warning();
      toast(NO_PAYMENT_RIGHT, "info");
      return;
    }
    if (billUnsaved) {
      haptics.warning();
      toast("Итог изменился — сначала сохраните запись", "info");
      return;
    }
    if (clientUnsaved) {
      haptics.warning();
      toast("Клиент изменился — сначала сохраните запись", "info");
      return;
    }
    if (visitCancelled) {
      haptics.warning();
      toast("Визит отменён — оплату не записать", "info");
      return;
    }
    if (problem === "exceeds") {
      haptics.warning();
      toast("Сумма больше остатка", "error");
      return;
    }
    if (problem === "empty") {
      haptics.warning();
      toast("Введите сумму", "error");
      return;
    }
    const amount = amountCents / 100;
    // Часы — сейчас, а не на последней перерисовке (`paymentKindAt`).
    const now = businessNow();
    const kind = paymentKindAt(
      { date: visit.date, time_start: visit.timeStart, status: visit.status },
      now,
    );
    if (!appointment) {
      const same = pending?.accountId === account.id && pending.kind === kind;
      onPendingChange(same ? null : { accountId: account.id, amount, kind, full: !amountMode });
      haptics.tap();
      return;
    }
    const already = (rowsByAccount.get(account.id) ?? []).reduce((sum, row) => sum + row.amount, 0);
    const requestId = randomUuid();
    const closeVisit = closesVisit(
      { date: visit.date, time_start: visit.timeStart, status: appointment.status },
      kind,
      now,
    );
    const source = appointment;
    const optimistic = optimisticRecordPayment(source, {
      requestId,
      amount,
      accountId: account.id,
      accountKind: account.kind,
      kind,
      closeVisit,
      paidAt: new Date().toISOString(),
    });
    haptics.success();
    onAppointmentChanged(optimistic);
    setPartText(null);
    toast(
      recordedToast({ kind, amount, already, accountName: account.name }),
      "success",
      { label: "Снять", onPress: () => runCancel(optimistic, requestId, account.name, amount) },
    );
    // Ответ — обещанием, как у снятия выше: отказ слышен и после ухода.
    record
      .mutateAsync({
        appointmentId: source.id,
        accountId: account.id,
        amount,
        requestId,
        kind,
        closeVisit,
        optimistic,
      })
      .then((fresh) => onAppointmentChanged(fresh))
      .catch((error: unknown) => {
        haptics.error();
        onAppointmentChanged(source);
        toast(error instanceof Error ? error.message : "Не удалось записать оплату", "error");
      });
  };

  const handlePaidTileTap = async (
    account: PaymentAccountOption,
    accountRowsForTile: PaymentRow[],
  ) => {
    if (!bookingInPlan) {
      tariffNudge();
      return;
    }
    // Снять оплату — тоже запись денег: то же право, что у приёма.
    if (!canTakeMoney) {
      haptics.warning();
      toast(NO_PAYMENT_RIGHT, "info");
      return;
    }
    const cancellable = accountRowsForTile.filter((row) => row.cancellable);
    if (!appointment || cancellable.length === 0) {
      toast("Этот платёж снимается в карточке записи", "info");
      return;
    }
    const index = await chooseOption(
      `${account.name}: деньги не поступили?`,
      cancellable.map((row) => ({
        label: `Снять ${formatEURExact(row.amount)}${row.kind === "prepayment" ? " · предоплата" : ""}${row.paidAt ? ` · ${paidAtLabel(row.paidAt, businessNow().ymd)}` : ""}`,
        destructive: true,
      })),
      { message: "Платёж уйдёт из записи, в финансах будет сторно. Это не возврат клиенту." },
    );
    if (index == null) return;
    const row = cancellable[index];
    if (!row) return;
    runCancel(appointment, row.id, account.name, row.amount);
  };

  // Поле открывается ПУСТЫМ: вся сумма — это тап по плитке без поля, а сюда
  // приходят за другой суммой, и стирать подставленный итог было бы лишним.
  const handleAmountToggle = () => {
    if (!bookingInPlan) {
      tariffNudge();
      return;
    }
    if (outstanding <= 0 && !amountMode) {
      haptics.warning();
      return;
    }
    haptics.tap();
    setPartText(amountMode ? null : "");
  };

  const handleInvoice = () => {
    haptics.tap();
    if (!appointment) {
      toast("Сначала создайте запись — инвойс выставляется по ней", "info");
      return;
    }
    if (invoice) {
      router.push(`/invoices/${invoice.id}` as Href);
      return;
    }
    router.push({
      pathname: "/invoices/new",
      params: { appointmentId: appointment.id },
    } as unknown as Href);
  };

  const caption = blockCaption({
    hasTeam: Boolean(teamId),
    hasAppointment: Boolean(appointment),
    visitCompleted: appointment?.status === "completed",
    outstanding,
    rowsCount: rows.length,
    amountMode,
    started,
    hasPending: Boolean(pending),
    outstandingLabel: formatEURExact(outstanding / 100),
    overpaid,
    overpaidLabel: formatEURExact(overpaid / 100),
    billUnsaved,
    clientUnsaved,
    visitCancelled,
  });
  const captionColor =
    caption?.tone === "success"
      ? t.success
      : caption?.tone === "warning"
        ? t.warning
        : undefined;

  // ИСТОРИЯ ПЛАТЕЖЕЙ — ЗДЕСЬ, А НЕ В ЛЕНТЕ КОМПАНИИ (владелец 2026-09-09).
  // Главная показывает запись одной строкой; сколько раз платили и что
  // снимали — вопрос про ЭТОГО клиента, и открывается он из его записи.
  const [historyOpen, setHistoryOpen] = useState(false);

  const showAmountField = amountMode && outstanding > 0;

  // ЗНАЧОК ЖИВЁТ, ПОКА ЕМУ ЕСТЬ ЧТО ДЕЛАТЬ (владелец 2026-09-10: «блок оплаты
  // занимает слишком много места… некрасиво»). На НОВОЙ записи все три не
  // могли ничего: «часть суммы» не от чего отсчитывать при нуле, инвойс не на
  // что выписывать, история платежей пуста. Три мёртвых тапа — и полоса в
  // сорок точек, в которой нет ни слова, только они, прижатые вправо.
  const canSplit = outstanding > 0 && canTakeMoney;
  // ТАРИФ БЕЗ ДОКУМЕНТОВ — ЗНАЧОК СЕРЫЙ, А НЕ ПРОПАДАЕТ (владелец 1.10:
  // «закончилась подписка — всё видно, новое серым»). У аккаунта, чей тариф
  // кончился, остались записи с неоплаченным остатком: значок «Инвойс» на
  // месте, тап поднимает плашку «Нужно изменить тариф» вместо выписки
  // (`enforce_plan_limits` её всё равно отбил бы). Уже выписанный документ
  // открывается как раньше — бумагу не теряем.
  // Инвойсы — функция компании (STORY-088): выключены — иконки нет, даже у
  // уже выставленного (он открывается из «Файлов», когда функцию вернут).
  const canInvoice = documentsOn && (Boolean(invoice) || outstanding > 0);
  const invoiceTariffLocked = !invoice && !canUseDocuments;
  const hasHistory = canSeeHistory && rows.length > 0;
  const anyAction = Boolean(teamId) && (canSplit || canInvoice || hasHistory);
  // Строка состояния нужна, когда ей ЕСТЬ ЧТО СКАЗАТЬ: подпись, поле суммы или
  // хоть одно живое действие. Иначе блок начинается сразу со счетов.
  const showStateRow = Boolean(caption?.text) || showAmountField || anyAction;

  return (
    <SectionCard title="Оплата">
      {showStateRow ? (
      <PaymentStateRow
        caption={caption?.text}
        captionColor={captionColor}
        captionTone={caption && caption.tone !== "neutral" ? "money" : "neutral"}
        amount={
          showAmountField
            ? {
                symbol: moneySymbol(currency),
                value: partText ?? "",
                onChangeText: setPartText,
                hint:
                  problem === "exceeds"
                    ? "Больше остатка"
                    : problem === "empty"
                      ? `Остаток ${formatEURExact(outstanding / 100)}`
                      : `Останется ${formatEURExact((outstanding - amountCents) / 100)}`,
                hintTone: problem === "exceeds" ? "danger" : "neutral",
              }
            : undefined
        }
        right={
          anyAction ? (
            <>
              {canSplit ? (
                <ModeIconButton
                  icon={Split}
                  label={started ? "Часть суммы" : "Предоплата"}
                  active={amountMode}
                  dimmed={!bookingInPlan}
                  onPress={handleAmountToggle}
                />
              ) : null}
              {canInvoice ? (
                <ModeIconButton
                  icon={FileText}
                  label="Инвойс"
                  active={Boolean(invoice)}
                  dimmed={invoiceTariffLocked}
                  onPress={invoiceTariffLocked ? tariffNudge : handleInvoice}
                />
              ) : null}
              {hasHistory ? (
                <ModeIconButton icon={History} label="История платежей" onPress={() => setHistoryOpen(true)} />
              ) : null}
            </>
          ) : null
        }
      />
      ) : null}
      {/* СТРОКИ ИНВОЙСА ЗДЕСЬ БОЛЬШЕ НЕТ (владелец 20.09: «ты сгенерировал
          инвойс — но он должен быть в файлах, в оплате нет его»). Выписанный
          документ живёт плашкой в блоке «Файлы», а в оплате остаётся только
          значок, которым его выписывают и открывают. */}
      {unattributed.map((row) => (
        <Text key={row.id} style={{ marginHorizontal: 16, marginTop: 4, fontSize: 13, color: t.sub }}>
          {row.kind === "prepayment" ? "Предоплата" : "Оплачено"} {formatEURExact(row.amount)} · счёт определён автоматически
        </Text>
      ))}
      {/* НЕ ЗАГРУЗИЛИСЬ — НЕ ЗНАЧИТ «НЕТ СЧЕТОВ». Ошибка сети раньше
          рисовалась как «У команды нет счёта — создать счёт»: плиток не было,
          оплата «не записывалась», а блок звал завести второй такой же счёт.
          Теперь блок говорит, что случилось, и сам повторяет запрос. */}
      {!teamId || (accounts.length === 0 && !accountsLoaded && accountsFailures === 0) ? null : accounts.length === 0 && !accountsLoaded ? (
        <Text style={{ marginHorizontal: 16, marginTop: 4, marginBottom: 12, fontSize: 13, color: t.sub }}>
          Счета не загрузились — пробуем ещё раз
        </Text>
      ) : accounts.length === 0 ? (
        <NoAccountsNotice canCreate={canCreateAccount} onCreate={() => setCreateOpen(true)} />
      ) : (
        <View
          className="flex-row flex-wrap"
          style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10, gap: TILE_GAP }}
        >
          {accounts.map((account) => {
            const accountRowsForTile = rowsByAccount.get(account.id) ?? [];
            const paid = accountRowsForTile.reduce((sum, row) => sum + row.amount, 0);
            const isPaid = paid > 0;
            const isPending = pending?.accountId === account.id;
            // Пока сервер подтверждает платёж, плитки не гаснут: деньги уже
            // стоят на своей плитке, и серый всплеск всего ряда читался как
            // «думает». Повторный тап всё равно не пройдёт — `disabled`.
            const state = isPaid ? "paid" : isPending ? "pending" : !acceptsMoney ? "dim" : "idle";
            return (
              <PaymentTile
                key={account.id}
                icon={accountIcon(account)}
                label={account.name}
                color={account.color ?? t.ink}
                tint={account.color}
                width={tileWidth} compact
                state={state}
                amount={isPaid ? formatEURExact(paid) : undefined}
                disabled={busy}
                onPress={() =>
                  isPaid && paidTileIntent(amountMode) === "cancel"
                    ? void handlePaidTileTap(account, accountRowsForTile)
                    : handleTileTap(account)
                }
                accessibilityLabel={
                  isPaid
                    ? `${account.name}, получено ${formatEURExact(paid)}, ${amountMode ? `добавить ${formatEURExact(amountCents / 100)}` : "снять"}`
                    : `${account.name}, ${kindForTap === "prepayment" ? "предоплата" : "оплачено"} ${formatEURExact(amountCents / 100)}`
                }
              />
            );
          })}
        </View>
      )}
      <AccountEditorSheet
        visible={createOpen}
        accountId={null}
        onClose={() => setCreateOpen(false)}
        presetTeamId={teamId}
      />
      <PaymentHistorySheet
        visible={historyOpen}
        appointmentId={appointment?.id ?? null}
        onClose={() => setHistoryOpen(false)}
      />
    </SectionCard>
  );
}
