import { useFeatureOn } from "@/features/settings/company-features";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "expo-router";
import { formatEURExact } from "@babun/shared/common/utils/money";
import { usePaymentRights } from "../usePaymentRights";
import { useAppointmentInvoicePay } from "../use-appointment-invoice-pay";
import { useToast } from "@/components/ui/Toast";
import { useAppointmentReceipt } from "../use-appointment-receipt";
import { useCreditNoteLinks, useInvoices } from "@/features/invoices/queries";
import { liveAppointmentInvoices } from "@/features/invoices/appointment-invoices";
import { usePlanAllows, useTenant } from "@/features/settings/tenant";
import { useBusinessNow } from "../business-now";
import { useTeamPaymentAccounts } from "../payment-accounts";
import {
  amountCentsFromInput,
  amountProblem,
  blockCaption,
  paymentKindAt,
  paymentMath,
  paymentRows,
  slotUnsaved,
  visitStarted,
  type PaymentKind,
  type PaymentRow,
} from "../payment-draft";
import { useCancelPayment, useRecordPayment } from "../payment-mutations";
import { useTileWidth } from "../PaymentTiles";
import { useTariffNudge } from "@/features/tariffs/use-tariff";
import type { PaymentBlockProps } from "../PaymentBlock";

/** Queries, rights and derived state of the «Оплата» block. */
export function usePaymentBlock({
  appointment,
  teamId,
  totalDraft,
  visit,
  pending,
  onPendingChange,
  clientId,
}: PaymentBlockProps) {
  const router = useRouter();
  const documentsOn = useFeatureOn("documents");
  const toast = useToast();
  const currency = useTenant().data?.currency;
  const businessNow = useBusinessNow(teamId);
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
  const receiptState = useAppointmentReceipt(appointment?.id ?? null, documentsOn);
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
    documents: documentsLevel,
  } = usePaymentRights(teamId);
  // «Документы» (04.10): «Видит» открывает выписанный, «Меняет» и выписывает.
  const docWrite = documentsLevel === "write";
  const receiptNext = docWrite ? receiptState.next : null;
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
  // ВЫСТАВЛЕН ИНВОЙС — ДЕНЬГИ В НЕГО (владелец 04.10): к оплате — его остаток,
  // плитка записывает платёж инвойса, сервер закрывает им запись.
  const invoicePay = useAppointmentInvoicePay(invoice, appointment?.id ?? null);

  const started = visitStarted(
    { date: visit.date, time_start: visit.timeStart },
    businessNow(),
  );
  // СЧИТАЕМ ПО ИТОГУ ФОРМЫ. У сохранённой записи итог в базе — прошлая версия:
  // человек дописал услуги, «Итого» стало €280, а блок ещё жил числом 160 и
  // объявлял запись оплаченной. Правило и его причина — в `paymentMath`.
  const { outstanding: recordOutstanding, overpaid } = paymentMath(appointment, totalDraft);
  const outstanding = invoicePay.open ? invoicePay.remainingCents : recordOutstanding;
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
  // Перенесли в форме и не сохранили: сервер записал бы оплату и закрыл
  // визит по прежней дате (`slotUnsaved`).
  const slotChange = slotUnsaved(appointment, visit);
  // Отменённый визит денег не принимает — так решает сервер
  // (`record_appointment_payment`). Плитки гаснут заранее: тап рисовал
  // «оплачено» и через секунду откатывал с ошибкой (аудит 2026-10-03). Снять
  // уже принятое можно — это зелёная плитка.
  const visitCancelled =
    appointment !== null &&
    (appointment.status === "cancelled" || appointment.payment_status === "refunded");
  const moneyRight = invoicePay.open ? docWrite : canTakeMoney;
  const acceptsMoney = outstanding > 0 && !billUnsaved && !clientUnsaved && !slotChange && !visitCancelled && moneyRight && bookingInPlan;

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
    slotUnsaved: slotChange,
    visitCancelled,
  });

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
  // Инвойс — пока есть долг, после выставления (открыть) и после оплаты, если
  // по деньгам записи его ещё нет (выставится оплаченным, 04.10).
  const canInvoice =
    documentsOn &&
    documentsLevel !== "none" &&
    (Boolean(invoice) || (docWrite && (outstanding > 0 || Boolean(receiptState.invoiceNext))));
  // ЧЕК — ПОСЛЕ ОПЛАТЫ (владелец 03.10): есть приход без чека — значок ведёт
  // в составитель чека, заполненный этой оплатой; чек уже выписан — горит и
  // открывает его. Денег нет — значка нет.
  const canReceipt =
    documentsOn && documentsLevel !== "none" && Boolean(receiptNext || receiptState.latest);
  const receiptTariffLocked = !receiptState.latest && !canUseDocuments;
  const invoiceTariffLocked = !invoice && !canUseDocuments;
  // История — и у возвращённой записи: строк у неё нет (деньги вернули), но
  // приём и возврат в истории лежат, и именно их и ищут на отменённом визите.
  const hasHistory =
    canSeeHistory &&
    (rows.length > 0 ||
      (appointment?.payment_status === "refunded" &&
        ((appointment.prepaid_amount ?? 0) > 0 || (appointment.paid_amount ?? 0) > 0)));
  const anyAction = Boolean(teamId) && (canSplit || canInvoice || canReceipt || hasHistory);
  // Строка состояния нужна, когда ей ЕСТЬ ЧТО СКАЗАТЬ: подпись, поле суммы или
  // хоть одно живое действие. Иначе блок начинается сразу со счетов.
  const showStateRow = Boolean(caption?.text) || showAmountField || anyAction;

  return {
    router,
    toast,
    currency,
    businessNow,
    tileWidth,
    accounts,
    accountsLoaded,
    accountsFailures,
    record,
    cancel,
    receiptState,
    partText,
    setPartText,
    createOpen,
    setCreateOpen,
    canCreateAccount,
    canTakeMoney,
    receiptNext,
    bookingInPlan,
    tariffNudge,
    invoice,
    invoicePay,
    started,
    outstanding,
    billUnsaved,
    rowsByAccount,
    unattributed,
    busy,
    amountMode,
    kindForTap,
    amountCents,
    problem,
    clientUnsaved,
    slotChange,
    visitCancelled,
    moneyRight,
    acceptsMoney,
    caption,
    historyOpen,
    setHistoryOpen,
    showAmountField,
    canSplit,
    canInvoice,
    canReceipt,
    receiptTariffLocked,
    invoiceTariffLocked,
    hasHistory,
    anyAction,
    showStateRow,
  };
}

export type PaymentBlockState = ReturnType<typeof usePaymentBlock>;
