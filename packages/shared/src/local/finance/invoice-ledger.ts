// DB-backed invoice types: the server-issued, atomically-numbered
// invoice flow. These are the authoritative records that live in the
// public.invoices table.

import {
  centsToMoney,
  divideRoundHalfAwayFromZero,
  moneyToCents,
  netFromGross,
  round2,
  vatCentsFromGross,
  vatCentsOnNet,
  vatFromGross,
} from "./vat";

import type {
  InvoiceDisplayStatus,
  InvoiceLedger,
  InvoiceLineDraft,
  InvoicePaymentLedger,
  InvoicePaymentRefundDestination,
  InvoiceSettlement,
  InvoiceTotals,
  InvoiceVatMode,
} from "./invoice-ledger/types";

export type {
  InvoiceClientSnapshot,
  InvoiceDisplayStatus,
  InvoiceKind,
  InvoiceLedger,
  InvoiceLedgerWithLines,
  InvoiceLineDraft,
  InvoiceLineLedger,
  InvoiceObjectAddressParts,
  InvoiceObjectSnapshot,
  InvoicePaymentLedger,
  InvoicePaymentRefundDestination,
  InvoiceSellerSnapshot,
  InvoiceSettlement,
  InvoiceStatus,
  InvoiceTotals,
  InvoiceVatMode,
} from "./invoice-ledger/types";
export {
  parseInvoiceClientSnapshot,
  parseInvoiceSellerSnapshot,
} from "./invoice-ledger/snapshots";

// Номер документа клиент НЕ собирает: его выдаёт сервер из серии юрлица при
// выпуске (`next_document_number`, STORY-101), а предпросмотр берётся у
// сервера же (`peek_document_number`) — одна формула, один источник.

/**
 * Split a gross total into net + VAT. Cyprus standard is 19%. We treat
 * the input as the customer-facing total (VAT-inclusive) — the most
 * common case at the till.
 *
 * ДЕЛЕГИРУЕТ в vat.ts — единственную реализацию разложения НДС (канон:
 * «вся математика в applyTxVat» и его помощниках). Порядок совпадает с SQL
 * issue_invoice: налог первым, half-up. Считать здесь по-своему нельзя —
 * своя формула без EPSILON давала на ровной половине цента (0,27 € при 20%)
 * превью 0,04/0,23 против серверных 0,05/0,22.
 */
export function splitVatInclusive(
  total: number,
  vatPercent: number,
): { net: number; vat: number } {
  return {
    net: netFromGross(total, vatPercent),
    vat: vatFromGross(total, vatPercent),
  };
}

/**
 * ИТОГ ПОЗИЦИИ — ОДНА ФУНКЦИЯ НА ВЕСЬ ПРОДУКТ.
 *
 * Её зовут ВСЕ, кто показывает или пишет сумму строки: карточка позиции,
 * лист позиции, бумага документа, сборка строк для записи и контрольное
 * чтение после выставления. Пока их было двое — `calculateInvoiceTotals`
 * считала одно, а строка печаталась через `qty * price` в double, — человек
 * видел в позиции 3,01, а в итоге 3,02.
 *
 * СЧИТАЕМ ТАК ЖЕ, КАК СЕРВЕР. SQL `issue_invoice` и `update_invoice_draft`
 * пишут `round(qty * unit_price, 2)` на `numeric`: точное умножение и
 * округление половины ОТ НУЛЯ. `round2(qty * unit_price)` в double на
 * 1,5 × 2,01 даёт 3.0149999999999997 → 3,01, а сервер — ровные 3,015 → 3,02.
 * Инвойс к этому моменту УЖЕ создан и номер израсходован, а контрольное
 * чтение падает: человек видит ошибку выставления вместо счёта. Дробные
 * количества стали штатными вместе с единицей измерения («4 м», «2,5 ч»),
 * так что пар с расхождением сотни: 1,5×2,01; 1,5×2,07; 1,5×2,15; 1,5×2,51…
 *
 * Поэтому умножаем ЦЕЛЫМИ на BigInt: количество — до трёх знаков, цена — до
 * двух (те же пределы, что стережёт сервер), произведение живёт в тысячных
 * долях цента. Переполнения здесь нет по построению — потому и нет
 * запасного float-пути, который молча возвращал бы прежний неверный цент.
 */
function invoiceLineTotalCents(qty: number, unitPrice: number): bigint {
  if (!Number.isFinite(qty) || !Number.isFinite(unitPrice)) return 0n;
  const qtyThousandths = BigInt(invoiceQuantityToThousandths(qty));
  const priceCents = moneyToCents(unitPrice);
  return divideRoundHalfAwayFromZero(qtyThousandths * priceCents, 1000n);
}

/** Количество → тысячные доли, ЕДИНСТВЕННЫЙ перевод на продукт. Сервер
 *  требует не больше трёх знаков (`round(qty, 3) is distinct from qty`), и
 *  тем же числом валидатор нормализует количество перед отправкой: считай
 *  умножение по одному правилу, а отправляй по другому — и они разойдутся. */
export function invoiceQuantityToThousandths(qty: number): number {
  if (!Number.isFinite(qty)) return 0;
  return Math.round(qty * 1000);
}

export function invoiceLineTotal(qty: number, unitPrice: number): number {
  return centsToMoney(invoiceLineTotalCents(qty, unitPrice));
}

/**
 * Canonical invoice arithmetic — зеркало серверного расчёта из `issue_invoice`
 * и `update_invoice_draft`, бит в бит:
 *   base := сумма уже округлённых до цента строк;
 *   inclusive → vat := round(base − base / (1 + rate/100), 2), net := base − vat;
 *   exclusive → vat := round(base * rate / 100, 2), total := base + vat.
 * Всё это считается на целых центах: в double те же формулы расходились с
 * сервером на ровной половине цента (12,81 € при 20 % «включено»), и
 * контрольное чтение роняло уже выставленный документ.
 */
export function calculateInvoiceTotals(
  lines: readonly InvoiceLineDraft[],
  vatMode: InvoiceVatMode,
  vatPercent: number,
): InvoiceTotals {
  const baseCents = lines.reduce(
    (sum, line) => sum + invoiceLineTotalCents(line.qty, line.unit_price),
    0n,
  );

  if (vatMode === "off" || vatPercent <= 0) {
    const base = centsToMoney(baseCents);
    return { subtotal_net: base, vat_amount: 0, total: base };
  }

  if (vatMode === "inclusive") {
    const vatCents = vatCentsFromGross(baseCents, vatPercent);
    return {
      subtotal_net: centsToMoney(baseCents - vatCents),
      vat_amount: centsToMoney(vatCents),
      total: centsToMoney(baseCents),
    };
  }

  const vatCents = vatCentsOnNet(baseCents, vatPercent);
  return {
    subtotal_net: centsToMoney(baseCents),
    vat_amount: centsToMoney(vatCents),
    total: centsToMoney(baseCents + vatCents),
  };
}

/**
 * ВИДЕН ЛИ ДОКУМЕНТ В СРЕЗЕ КОМАНДЫ. Инвойс знает свою команду сам, а бумага
 * БЕЗ хозяина — общая: её видно в любом срезе (то же правило, что у чека без
 * команды).
 *
 * Правило живёт одной функцией, потому что витрины уже расходились: список
 * документов пропускал бесхозный инвойс, а плитка «Документы» отсекала его
 * строгим `brigade_id !== scope`. Работа при этом вычёркивалась из «Долгов»
 * как «уже выставленная» — и дебиторка пропадала из ОБЕИХ цифр разом.
 */
export function invoiceInTeamScope(
  invoice: Pick<InvoiceLedger, "brigade_id">,
  teamId: string | null | undefined,
): boolean {
  if (!teamId || !invoice.brigade_id) return true;
  return invoice.brigade_id === teamId;
}

/**
 * ЗАЯВКИ, НА КОТОРЫЕ УЖЕ ВЫСТАВЛЕН ЖИВОЙ СЧЁТ. Их деньги считает плитка
 * «Документы», и в «Долгах» они были бы посчитаны второй раз.
 *
 * Правило одно на продукт, потому что им считают и цифра, и список под ней
 * (плитка «Долги», лента долгов, `DebtorsList`): спорить о том, выставлен ли
 * счёт, витрины не имеют права — раньше одна показывала «Долги €0», а другая
 * должника на €250. Из набора выпадают:
 *   • аннулированный (`void`) и отменённый кредит-нотой (`cancelled`) — они
 *     ничего не ждут, и работа возвращается в долги;
 *   • сама кредит-нота: она несёт заявку своего инвойса, а статус у неё
 *     «выставлена», то есть после отмены она продолжала вычёркивать работу.
 */
export function invoicedAppointmentIds(
  invoices: readonly Pick<InvoiceLedger, "appointment_id" | "status" | "kind">[],
): Set<string> {
  const ids = new Set<string>();
  for (const invoice of invoices) {
    if (!invoice.appointment_id) continue;
    if (invoice.kind === "credit_note") continue;
    if (invoice.status === "void" || invoice.status === "cancelled") continue;
    ids.add(invoice.appointment_id);
  }
  return ids;
}

/** `overdue` is a view state: the database keeps the legal status `issued`. */
export function invoiceDisplayStatus(
  invoice: Pick<InvoiceLedger, "status" | "due_on">,
  today = localDateKey(new Date()),
  settlement?: Pick<InvoiceSettlement, "isPaid" | "isPartial">,
): InvoiceDisplayStatus {
  if (invoice.status === "void") return "void";
  if (settlement?.isPaid) return "paid";
  if (settlement?.isPartial) return "partial";
  if (
    invoice.status === "issued" &&
    invoice.due_on &&
    invoice.due_on < today
  ) {
    return "overdue";
  }
  return invoice.status;
}

/**
 * Summarise every ledger row attached to an invoice. A legacy `paid` invoice
 * is treated as fully paid even when it predates payment rows; real refunds
 * still reopen the balance because they are subtracted after that fallback.
 */
export function calculateInvoiceSettlement(
  invoice: Pick<InvoiceLedger, "status" | "total" | "credited_amount">,
  payments: readonly InvoicePaymentLedger[],
): InvoiceSettlement {
  // К ОПЛАТЕ = СУММА − СТОРНИРОВАНО (частичная кредит-нота) — то же
  // правило, что у сервера (`sync_invoice_status_from_ledger`).
  const due = round2(Math.max(0, invoice.total - (invoice.credited_amount ?? 0)));
  const income = round2(
    payments.reduce(
      (sum, payment) =>
        payment.type === "income" ? sum + Math.max(0, payment.amount) : sum,
      0,
    ),
  );
  const refunded = round2(
    payments.reduce(
      (sum, payment) =>
        payment.type === "refund" ? sum + Math.abs(payment.amount) : sum,
      0,
    ),
  );
  const recognizedIncome =
    invoice.status === "paid" ? Math.max(due, income) : income;
  const rawPaid = round2(Math.max(0, recognizedIncome - refunded));
  const paid = round2(Math.min(due, rawPaid));
  const overpaid = round2(Math.max(0, rawPaid - due));
  // ЗАКРЫТАЯ БУМАГА ДЕНЕГ НЕ ЖДЁТ. «Аннулирован» — ошибочный документ;
  // «отменён» — сторнированный кредит-нотой, и сервер отменяет инвойс только
  // когда у нас по нему ничего не осталось (`cancel_invoice`: доходы минус
  // возвраты). Пока `cancelled` считался открытым, отменённый счёт показывал
  // остаток, попадал в «ждут оплату» и звал принять по нему деньги.
  const closed = invoice.status === "void" || invoice.status === "cancelled";
  const remaining = closed ? 0 : round2(Math.max(0, due - paid));
  return {
    due,
    income,
    refunded,
    paid,
    remaining,
    overpaid,
    isPartial: !closed && paid > 0 && remaining > 0,
    isPaid: !closed && remaining <= 0,
  };
}

/**
 * Amount still refundable for one concrete income payment. Refund rows that
 * belong to other payments never reduce this value.
 */
export function calculateInvoicePaymentRefundable(
  payment: InvoicePaymentLedger,
  payments: readonly InvoicePaymentLedger[],
): number {
  if (payment.type !== "income") return 0;
  const original = round2(Math.max(0, payment.amount));
  const refunded = round2(
    payments.reduce(
      (sum, row) =>
        row.type === "refund" && row.refund_of_id === payment.id
          ? sum + Math.abs(row.amount)
          : sum,
      0,
    ),
  );
  return round2(Math.max(0, original - refunded));
}

/**
 * Route a refund to the writer that owns all affected state. Appointment
 * receipts must update the appointment mirrors and ledger atomically; manual
 * invoice receipts can use the invoice refund RPC directly.
 */
export function invoicePaymentRefundDestination(
  payment: InvoicePaymentLedger,
  payments: readonly InvoicePaymentLedger[],
): InvoicePaymentRefundDestination {
  if (calculateInvoicePaymentRefundable(payment, payments) <= 0) return null;
  if (payment.source === "auto" || payment.appointment_payment_kind != null) {
    return "appointment";
  }
  return "invoice";
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

export const INVOICE_STATUS_LABELS: Record<InvoiceDisplayStatus, string> = {
  issued: "Выставлен",
  partial: "Частично оплачен",
  overdue: "Просрочен",
  paid: "Оплачен",
  void: "Аннулирован",
  // Сторнирован встречным документом: у клиента на руках и инвойс, и
  // кредит-нота, поэтому слово другое — «отменён», а не «аннулирован».
  cancelled: "Отменён",
};
