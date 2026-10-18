import {
  newCustomServiceId,
  type Appointment,
  type AppointmentService,
} from "@babun/shared/local/appointments";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import { lineTotal } from "@babun/shared/local/finance/appointment-calc";
import type { InvoiceLineLedger } from "@babun/shared/local/finance/invoice-ledger";

// ЧЕК НА УЖЕ ПРИНЯТУЮ ОПЛАТУ: у оплаченной записи — значок чека; нажатие сразу
// заполняет чек и перекидывает на него, а человек проверяет, при нужде правит
// и только тогда выставляет (то же с оплаченного инвойса).
//
// Деньги уже лежат в журнале, поэтому клиент, счёт и сумма берутся из
// проводки: `issue_receipt` снимает их с неё сам. Строки работ — КОПИЯ услуг
// записи или строк инвойса, всегда, и при оплате частью тоже: просто копирует
// блок с услугами. Бумага так и говорит: «Итого работ €50»,
// «Получено €20».

type Tx = Pick<
  FinanceTransaction,
  "id" | "type" | "amount" | "vat_mode" | "vat_amount" | "refund_of_id" | "created_at"
>;

const cents = (euros: number) => Math.round(euros * 100);

/** Чем должны сложиться строки: сумма без налога, если налог сверху, иначе
 *  вся оплата (налог внутри цены строк). */
export function paymentLinesTotal(tx: Pick<Tx, "amount" | "vat_mode" | "vat_amount">): number {
  const vat = tx.vat_mode === "exclusive" ? (tx.vat_amount ?? 0) : 0;
  return cents(tx.amount - vat) / 100;
}

/**
 * Доходы, которым ещё нужен чек: приход, не возвращённый целиком (сервер
 * откажет «оформлен полный возврат»), и без своего чека. Старые — первыми:
 * предоплата раньше доплаты.
 */
export function incomesAwaitingReceipt<T extends Tx>(
  ledger: readonly T[],
  receipts: readonly { transaction_id: string | null }[],
): T[] {
  const withReceipt = new Set(receipts.map((r) => r.transaction_id));
  const refunded = new Map<string, number>();
  for (const tx of ledger) {
    if (tx.type === "refund" && tx.refund_of_id) {
      refunded.set(tx.refund_of_id, (refunded.get(tx.refund_of_id) ?? 0) + Math.abs(tx.amount));
    }
  }
  return ledger
    .filter(
      (tx) =>
        tx.type === "income" &&
        tx.amount > 0 &&
        !withReceipt.has(tx.id) &&
        cents(tx.amount - (refunded.get(tx.id) ?? 0)) > 0,
    )
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/**
 * ПРИХОДЫ ЗАПИСИ БЕЗ ИНВОЙСА: оплачено заранее — можно выписать инвойс, и он сразу
 * принимает эту оплату. Живой приход,
 * не привязанный к инвойсу и не возвращённый целиком, — на него форма
 * выставит инвойс сразу оплаченным (`issue_invoice` с `p_link_to_tx_id`).
 * Первым — самый ранний, как у чека.
 */
export function incomesAwaitingInvoice<T extends Tx & { invoice_id?: string | null }>(
  ledger: readonly T[],
): T[] {
  const refunded = new Map<string, number>();
  for (const tx of ledger) {
    if (tx.type === "refund" && tx.refund_of_id) {
      refunded.set(tx.refund_of_id, (refunded.get(tx.refund_of_id) ?? 0) + Math.abs(tx.amount));
    }
  }
  return ledger
    .filter(
      (tx) =>
        tx.type === "income" &&
        tx.amount > 0 &&
        !tx.invoice_id &&
        cents(tx.amount - (refunded.get(tx.id) ?? 0)) > 0,
    )
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/** Своя строка чека — не из прайса. */
function customLine(name: string, qty: number, price: number, unit: string | null): AppointmentService {
  const line: AppointmentService = {
    serviceId: newCustomServiceId(),
    quantity: qty,
    pricePerUnit: price,
    originalPrice: price,
    totalPrice: 0,
    duration: 0,
    serviceName: name,
    unit,
  };
  return { ...line, totalPrice: lineTotal(line) };
}

/**
 * Строки, которые чек подставит сам: строки инвойса оплаты, иначе услуги
 * записи. Источника нет (доход без записи и инвойса) — одна строка на сумму
 * оплаты, её название правят в «Итого».
 */
export function paymentReceiptLines(
  tx: Pick<Tx, "amount" | "vat_mode" | "vat_amount">,
  source: {
    invoiceLines?: readonly Pick<InvoiceLineLedger, "title" | "qty" | "unit" | "unit_price">[] | null;
    appointment?: Pick<Appointment, "services"> | null;
  },
  fallbackTitle: string,
): AppointmentService[] {
  const fromInvoice = (source.invoiceLines ?? [])
    .filter((line) => line.unit_price >= 0)
    .map((line) => customLine(line.title, line.qty, line.unit_price, line.unit ?? null));
  if (fromInvoice.length > 0) return fromInvoice;
  const fromVisit = (source.appointment?.services ?? []).map((line) => ({ ...line }));
  if (fromVisit.length > 0) return fromVisit;
  return [customLine(fallbackTitle, 1, paymentLinesTotal(tx), null)];
}

/**
 * СКИДКА ИНВОЙСА — СКИДКОЙ ЧЕКА. В перечень строка скидки (цена с минусом) не
 * идёт: это не работа. Но и молча выбросить её нельзя — чек напечатал бы
 * «Итого работ €200» над «Получено €180» без строки скидки. Её сумма
 * встаёт в «Итого» черновика той же фиксированной скидкой, что у записи.
 */
export function paymentReceiptDiscount(
  invoiceLines: readonly Pick<InvoiceLineLedger, "qty" | "unit_price">[] | null | undefined,
): { discountType: "fixed"; discountValue: string } | null {
  const off = (invoiceLines ?? [])
    .filter((line) => line.unit_price < 0)
    .reduce((sum, line) => sum + cents(Math.abs(line.qty * line.unit_price)), 0);
  if (off <= 0) return null;
  return { discountType: "fixed", discountValue: String(off / 100) };
}
