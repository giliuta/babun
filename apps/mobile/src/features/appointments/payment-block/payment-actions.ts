import type { Href } from "expo-router";
import type { Appointment } from "@babun/shared/local/appointments";
import { randomUuid } from "@babun/shared/sync";
import { formatEURExact } from "@babun/shared/common/utils/money";
import { chooseOption } from "@/lib/choose";
import { haptics } from "@/lib/haptics";
import type { PaymentAccountOption } from "../payment-accounts";
import {
  closesVisit,
  paidAtLabel,
  paymentKindAt,
  recordedToast,
  type PaymentRow,
} from "../payment-draft";
import { optimisticCancelPayment, optimisticRecordPayment } from "../payment-optimistic";
import type { PaymentBlockProps } from "../PaymentBlock";
import type { PaymentBlockState } from "./use-payment-block";

/** Права на оплату записи у этого человека в этом календаре нет: сервер
 *  откажет, поэтому плитки гаснут заранее и называют причину. */
const NO_PAYMENT_RIGHT = "Принимать оплату в этом календаре вам не разрешили";

/** Tap handlers of the «Оплата» block: tiles, part amount, invoice, receipt. */
export function paymentActions(
  state: PaymentBlockState,
  { appointment, visit, pending, onPendingChange, onAppointmentChanged }: PaymentBlockProps,
) {
  const {
    router,
    toast,
    businessNow,
    record,
    cancel,
    receiptState,
    setPartText,
    canTakeMoney,
    receiptNext,
    bookingInPlan,
    tariffNudge,
    invoice,
    invoicePay,
    outstanding,
    billUnsaved,
    rowsByAccount,
    busy,
    amountMode,
    amountCents,
    problem,
    clientUnsaved,
    slotChange,
    visitCancelled,
    moneyRight,
  } = state;

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
    if (outstanding <= 0 || busy || invoicePay.busy || invoicePay.loading) return;
    if (!bookingInPlan) {
      tariffNudge();
      return;
    }
    if (!moneyRight) {
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
    if (slotChange) {
      haptics.warning();
      toast(
        slotChange === "date"
          ? "Дата изменилась — сначала сохраните запись"
          : "Время изменилось — сначала сохраните запись",
        "info",
      );
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
    // ПЛАТЁЖ ИНВОЙСА, А НЕ ЗАПИСИ: инвойс получает деньги и статус, запись
    // закрывается его зачётом, чек выписывается на этот платёж.
    if (invoicePay.open && appointment) {
      const source = appointment;
      haptics.success();
      setPartText(null);
      invoicePay
        .pay({
          accountId: account.id,
          accountKind: account.kind,
          amountCents,
          businessToday: businessNow().ymd,
        })
        .then((fresh) => {
          if (fresh) onAppointmentChanged(fresh);
          toast(`Оплата ${formatEURExact(amountCents / 100)} по ${invoicePay.number} · ${account.name}`, "success");
        })
        .catch((error: unknown) => {
          haptics.error();
          onAppointmentChanged(source);
          toast(error instanceof Error ? error.message : "Не удалось записать оплату", "error");
        });
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

  const handleReceipt = () => {
    haptics.tap();
    if (receiptNext) {
      router.push({
        pathname: "/documents/receipt-new",
        params: { transactionId: receiptNext.id },
      } as unknown as Href);
      return;
    }
    if (receiptState.latest) router.push(`/documents/receipt/${receiptState.latest.id}` as Href);
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
    // ОПЛАЧЕНО — ИНВОЙС НА ЭТИ ДЕНЬГИ (владелец 04.10: «оплачено заранее, а я
    // хочу ещё выписать инвойс, и он сразу принимает оплату»). Форма
    // заполнена приходом и выставит инвойс уже оплаченным, без долга.
    if (outstanding <= 0 && receiptState.invoiceNext) {
      const income = receiptState.invoiceNext;
      router.push({
        pathname: "/invoices/new",
        params: {
          transactionId: income.id,
          appointmentId: appointment.id,
          amount: String(income.amount),
          ...(appointment.client_id ? { clientId: appointment.client_id } : {}),
          ...(appointment.team_id ? { teamId: appointment.team_id } : {}),
        },
      } as unknown as Href);
      return;
    }
    router.push({
      pathname: "/invoices/new",
      params: { appointmentId: appointment.id },
    } as unknown as Href);
  };

  return { handleTileTap, handlePaidTileTap, handleAmountToggle, handleReceipt, handleInvoice };
}
