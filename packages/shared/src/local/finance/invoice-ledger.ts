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

/** `cancelled` — сторнирован кредит-нотой (2026-08-09); `void` остаётся
 *  легаси-статусом «внутренне аннулирован» и не переиспользуется:
 *  «удалили по ошибке» и «сторнировали документом» — разные события. */
export type InvoiceStatus = "issued" | "paid" | "void" | "cancelled";
export type InvoiceDisplayStatus = InvoiceStatus | "partial" | "overdue";
export type InvoiceVatMode = "off" | "inclusive" | "exclusive";

export interface InvoiceLineDraft {
  title: string;
  qty: number;
  unit_price: number;
  /** Что входит в работу — печатается второй строкой под названием позиции.
   *  Приезжает из описания услуги и дальше живёт СВОЕЙ жизнью: правка в счёте
   *  прайс не трогает, а документ помнит свою формулировку. */
  description?: string | null;
  /** Единица количества на бумаге: «4 м». Приезжает из услуги и дальше живёт
   *  СВОЕЙ жизнью — как и описание: правка в счёте прайс не трогает. */
  unit?: string | null;
}

export interface InvoiceTotals {
  subtotal_net: number;
  vat_amount: number;
  total: number;
}

export interface InvoicePaymentLedger {
  id: string;
  invoice_id: string;
  type: "income" | "refund";
  amount: number;
  account_id: string | null;
  payment_method: string | null;
  occurred_on: string;
  refund_of_id: string | null;
  notes: string | null;
  created_at: string;
  source?: string;
  appointment_payment_kind?: string | null;
}

export type InvoicePaymentRefundDestination = "invoice" | "appointment" | null;

export interface InvoiceSettlement {
  income: number;
  refunded: number;
  paid: number;
  remaining: number;
  overpaid: number;
  isPartial: boolean;
  isPaid: boolean;
}

/** Immutable legal party copied by the database when the invoice is issued. */
export interface InvoiceSellerSnapshot {
  schema_version: number;
  tenant_id: string | null;
  name: string | null;
  display_name: string | null;
  legal_name: string | null;
  vat_number: string | null;
  business_address: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  iban: string | null;
  bank_name: string | null;
  /** Логотип на момент выставления. null у документов, выписанных до того,
   *  как логотип начали печатать. */
  logo_url?: string | null;
  currency: string | null;
}

/** Immutable recipient copied by the database, including archive state then. */
export interface InvoiceClientSnapshot {
  schema_version: number;
  client_id: string | null;
  full_name: string | null;
  phone: string | null;
  phone_e164: string | null;
  whatsapp_phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  primary_address: string | null;
  archived: boolean;
  deleted_at: string | null;
}

export interface InvoiceLedger {
  id: string;
  tenant_id: string;
  number: string; // e.g. "INV-2026-001"
  year: number;
  seq: number;
  issued_on: string; // YYYY-MM-DD
  due_on: string | null;
  client_id: string | null;
  appointment_id: string | null;
  brigade_id: string | null;
  subtotal_net: number;
  vat_percent: number;
  vat_amount: number;
  total: number;
  currency: string;
  /** Язык БУМАГИ этого счёта: «ru» | «en». Живёт у документа, а не у
   *  компании: один клиент получает счёт по-английски, следующий по-русски,
   *  и вчерашняя бумага не переписывается от сегодняшней настройки. */
  language: string;
  status: InvoiceStatus;
  pdf_url: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  /** Optional in the domain shape so pre-migration offline fixtures still read. */
  seller_snapshot?: InvoiceSellerSnapshot | null;
  client_snapshot?: InvoiceClientSnapshot | null;
}

export interface InvoiceLineLedger {
  id: string;
  invoice_id: string;
  position: number;
  title: string;
  description: string | null;
  qty: number;
  /** Единица количества НА БУМАГЕ: «4 м» вместо «4». Хранится у строки, а не
   *  берётся из прайса, — выставленный документ заморожен, и смена единицы у
   *  услуги не переписывает уже отправленный клиенту счёт. */
  unit: string | null;
  unit_price: number;
  total: number;
}

export interface InvoiceLedgerWithLines extends InvoiceLedger {
  lines: InvoiceLineLedger[];
}

// `formatInvoiceNumber` здесь БОЛЬШЕ НЕ ЖИВЁТ (U49): жёсткие «3 знака,
// всегда год» спорили с настраиваемой нумерацией тенанта. Номер собирает
// единственная живая формула — apps/mobile/src/features/invoices/numbering.ts
// (prefix/padding/yearlyReset из настроек), а выпущенному документу номер
// выдаёт сервер (next_invoice_number / issue_invoice).

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
  invoice: Pick<InvoiceLedger, "status" | "total">,
  payments: readonly InvoicePaymentLedger[],
): InvoiceSettlement {
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
    invoice.status === "paid" ? Math.max(invoice.total, income) : income;
  const rawPaid = round2(Math.max(0, recognizedIncome - refunded));
  const paid = round2(Math.min(invoice.total, rawPaid));
  const overpaid = round2(Math.max(0, rawPaid - invoice.total));
  const remaining =
    invoice.status === "void"
      ? 0
      : round2(Math.max(0, invoice.total - paid));
  return {
    income,
    refunded,
    paid,
    remaining,
    overpaid,
    isPartial: invoice.status !== "void" && paid > 0 && remaining > 0,
    isPaid: invoice.status !== "void" && remaining <= 0,
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

export function parseInvoiceSellerSnapshot(
  value: unknown,
): InvoiceSellerSnapshot | null {
  const row = asObject(value);
  if (!row) return null;
  return {
    schema_version: numberValue(row.schema_version) ?? 1,
    tenant_id: stringValue(row.tenant_id),
    name: stringValue(row.name),
    display_name: stringValue(row.display_name),
    legal_name: stringValue(row.legal_name),
    vat_number: stringValue(row.vat_number),
    business_address: stringValue(row.business_address),
    address: stringValue(row.address),
    city: stringValue(row.city),
    country: stringValue(row.country),
    contact_email: stringValue(row.contact_email),
    contact_phone: stringValue(row.contact_phone),
    iban: stringValue(row.iban),
    bank_name: stringValue(row.bank_name),
    currency: stringValue(row.currency),
  };
}

export function parseInvoiceClientSnapshot(
  value: unknown,
): InvoiceClientSnapshot | null {
  const row = asObject(value);
  if (!row) return null;
  return {
    schema_version: numberValue(row.schema_version) ?? 1,
    client_id: stringValue(row.client_id),
    full_name: stringValue(row.full_name),
    phone: stringValue(row.phone),
    phone_e164: stringValue(row.phone_e164),
    whatsapp_phone: stringValue(row.whatsapp_phone),
    email: stringValue(row.email),
    address: stringValue(row.address),
    city: stringValue(row.city),
    primary_address: stringValue(row.primary_address),
    archived: row.archived === true,
    deleted_at: stringValue(row.deleted_at),
  };
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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
