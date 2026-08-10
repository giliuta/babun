import type { Client } from "@babun/shared/local/clients";
import {
  INVOICE_STATUS_LABELS,
  invoiceDisplayStatus,
  type InvoiceLedgerWithLines,
  type InvoicePaymentLedger,
  type InvoiceSettlement,
} from "@babun/shared/local/finance/invoice-ledger";
import type { Tenant } from "@/features/settings/tenant";
import {
  formatInvoiceDate,
  formatInvoiceMoney,
  invoiceVatMode,
} from "./format";

// ОДИН ДОКУМЕНТ — ДВА РЕНДЕРА.
//
// Владелец 2026-08-10: «должно быть зеркало инвойса, чтобы можно было сразу
// редактировать и смотреть». Зеркало и PDF обязаны показывать ОДНО И ТО ЖЕ —
// иначе клиент получит не то, что видел человек. Поэтому здесь собирается
// готовый к печати документ (уже отформатированные строки), а рисовать его
// умеют двое: HTML для PDF и экранная «бумага» на React Native.
//
// Почему не WebView: его нет в нативной сборке, а добавление требует пересборки
// приложения. Два рендера из одной модели — честная цена за живой предпросмотр
// сегодня; контрактный тест держит их в согласии.

export interface DocumentParty {
  name: string;
  lines: string[];
}

export interface DocumentLine {
  title: string;
  qty: string;
  unitPrice: string;
  total: string;
}

export interface DocumentTotal {
  label: string;
  value: string;
  grand?: boolean;
}

export interface DocumentPayment {
  date: string;
  title: string;
  details: string;
  amount: string;
  refund: boolean;
}

export interface InvoiceDocument {
  /** Номер документа. У черновика — тот, что получит при выставлении. */
  number: string;
  /** Черновик ещё не выставлен: печатаем это словом, а не выдуманным статусом. */
  draft: boolean;
  statusLabel: string;
  logoUrl: string | null;
  seller: DocumentParty;
  client: DocumentParty;
  issuedOn: string;
  dueOn: string;
  lines: DocumentLine[];
  totals: DocumentTotal[];
  /** Реквизиты для оплаты — печатаются отдельным блоком под итогом. */
  payTo: string[];
  settlement: { label: string; value: string }[];
  payments: DocumentPayment[];
  notes: string;
  footer: string;
}

export interface InvoiceDocumentDraft {
  number: string;
  issuedOn: string;
  dueOn: string | null;
  clientId: string | null;
  lines: readonly { title: string; qty: number; unitPrice: number }[];
  vatMode: "off" | "inclusive" | "exclusive";
  vatPercent: number;
  subtotalNet: number;
  vatAmount: number;
  total: number;
  currency: string;
  notes: string;
}

interface BaseInput {
  tenant?: Tenant;
  client?: Client;
}

export interface IssuedDocumentInput extends BaseInput {
  invoice: InvoiceLedgerWithLines;
  settlement: InvoiceSettlement;
  payments: readonly InvoicePaymentLedger[];
  accountNames?: ReadonlyMap<string, string>;
  businessToday?: string;
}

export interface DraftDocumentInput extends BaseInput {
  draft: InvoiceDocumentDraft;
}

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  cash: "Наличные",
  card: "Карта",
  transfer: "Перевод",
  other: "Другое",
};

export function buildInvoiceDocument(
  input: IssuedDocumentInput | DraftDocumentInput,
): InvoiceDocument {
  return "draft" in input ? draftDocument(input) : issuedDocument(input);
}

function issuedDocument({
  invoice,
  tenant,
  client,
  settlement,
  payments,
  accountNames,
  businessToday,
}: IssuedDocumentInput): InvoiceDocument {
  const displayStatus = invoiceDisplayStatus(invoice, businessToday, settlement);
  const seller = invoice.seller_snapshot;
  const recipient = invoice.client_snapshot;
  // Снимок — это ВЕСЬ юридический источник, включая поля, намеренно пустые на
  // момент выставления. Дополнять его живым профилем нельзя: переименовали
  // компанию — и старый документ бесшумно переписался бы.
  const sellerName = seller
    ? firstNonEmpty(seller.legal_name, seller.name, seller.display_name)
      || "Продавец не указан"
    : firstNonEmpty(tenant?.legal_name, tenant?.name) || "Продавец не указан";
  const vatMode = invoiceVatMode(invoice);

  return {
    number: invoice.number,
    draft: false,
    statusLabel: INVOICE_STATUS_LABELS[displayStatus],
    // Старый снимок логотипа не знает — печатаем текущий: в тот день его
    // просто не записывали, и это честнее пустой шапки.
    logoUrl: clean(seller?.logo_url) || clean(tenant?.logo_url) || null,
    seller: {
      name: sellerName,
      lines: compact([
        seller
          ? firstNonEmpty(seller.address, seller.business_address)
          : firstNonEmpty(tenant?.business_address, joinParts(tenant?.address, tenant?.city)),
        prefixed("VAT", seller ? clean(seller.vat_number) : clean(tenant?.vat_number)),
        seller ? clean(seller.contact_email) : clean(tenant?.contact_email),
        seller ? clean(seller.contact_phone) : clean(tenant?.contact_phone),
      ]),
    },
    client: {
      name: (recipient ? clean(recipient.full_name) : clean(client?.full_name))
        || "Получатель не указан",
      lines: compact([
        recipient
          ? firstNonEmpty(recipient.primary_address, recipient.address)
          : client
            ? primaryClientAddress(client)
            : "",
        recipient ? clean(recipient.email) : clean(client?.email),
        recipient ? clean(recipient.phone) : clean(client?.phone),
      ]),
    },
    issuedOn: formatInvoiceDate(invoice.issued_on),
    dueOn: formatInvoiceDate(invoice.due_on),
    lines: invoice.lines.map((line) => ({
      title: line.title,
      qty: formatQty(line.qty),
      unitPrice: formatInvoiceMoney(line.unit_price, invoice.currency),
      total: formatInvoiceMoney(line.total, invoice.currency),
    })),
    totals: totalRows({
      currency: invoice.currency,
      subtotalNet: invoice.subtotal_net,
      vatAmount: invoice.vat_amount,
      vatPercent: invoice.vat_percent,
      vatMode,
      total: invoice.total,
    }),
    payTo: compact([
      prefixed("IBAN", seller ? clean(seller.iban) : clean(tenant?.iban)),
      prefixed("Банк", seller ? clean(seller.bank_name) : clean(tenant?.bank_name)),
    ]),
    settlement: [
      { label: "Оплачено", value: formatInvoiceMoney(settlement.paid, invoice.currency) },
      { label: "Остаток", value: formatInvoiceMoney(settlement.remaining, invoice.currency) },
    ],
    payments: payments.map((payment) => {
      const account = payment.account_id ? accountNames?.get(payment.account_id) : undefined;
      const method = payment.payment_method
        ? PAYMENT_METHOD_LABEL[payment.payment_method] ?? payment.payment_method
        : "";
      const refund = payment.type === "refund";
      return {
        date: formatInvoiceDate(payment.occurred_on),
        title: refund ? "Возврат" : "Платёж",
        details: [account, method].filter(Boolean).join(" · "),
        amount: `${refund ? "−" : ""}${formatInvoiceMoney(Math.abs(payment.amount), invoice.currency)}`,
        refund,
      };
    }),
    notes: clean(invoice.notes),
    footer: `Документ сформирован из данных инвойса ${invoice.number}. Валюта: ${invoice.currency}.`,
  };
}

function draftDocument({ draft, tenant, client }: DraftDocumentInput): InvoiceDocument {
  return {
    number: draft.number,
    draft: true,
    statusLabel: "Черновик",
    logoUrl: clean(tenant?.logo_url) || null,
    seller: {
      name: firstNonEmpty(tenant?.legal_name, tenant?.name) || "Продавец не указан",
      lines: compact([
        firstNonEmpty(tenant?.business_address, joinParts(tenant?.address, tenant?.city)),
        prefixed("VAT", clean(tenant?.vat_number)),
        clean(tenant?.contact_email),
        clean(tenant?.contact_phone),
      ]),
    },
    client: {
      name: clean(client?.full_name) || "Получатель не указан",
      lines: compact([
        client ? primaryClientAddress(client) : "",
        clean(client?.email),
        clean(client?.phone),
      ]),
    },
    issuedOn: formatInvoiceDate(draft.issuedOn),
    dueOn: formatInvoiceDate(draft.dueOn),
    lines: draft.lines.map((line) => ({
      title: line.title,
      qty: formatQty(line.qty),
      unitPrice: formatInvoiceMoney(line.unitPrice, draft.currency),
      total: formatInvoiceMoney(round2(line.qty * line.unitPrice), draft.currency),
    })),
    totals: totalRows({
      currency: draft.currency,
      subtotalNet: draft.subtotalNet,
      vatAmount: draft.vatAmount,
      vatPercent: draft.vatPercent,
      vatMode: draft.vatMode,
      total: draft.total,
    }),
    payTo: compact([
      prefixed("IBAN", clean(tenant?.iban)),
      prefixed("Банк", clean(tenant?.bank_name)),
    ]),
    // У черновика платить ещё нечего — блок оплаты не печатаем вовсе.
    settlement: [],
    payments: [],
    notes: clean(draft.notes),
    footer: `Черновик. Номер ${draft.number} закрепится за документом при выставлении.`,
  };
}

function totalRows(input: {
  currency: string;
  subtotalNet: number;
  vatAmount: number;
  vatPercent: number;
  vatMode: "off" | "inclusive" | "exclusive";
  total: number;
}): DocumentTotal[] {
  // Документ БЕЗ НАЛОГА не должен говорить о налоге дважды («Без НДС» и снова
  // «Без НДС · €0») — это выглядело как ошибка счёта. Строка налога появляется
  // только там, где налог есть.
  if (input.vatMode === "off" || input.vatAmount <= 0) {
    return [
      { label: "Сумма", value: formatInvoiceMoney(input.subtotalNet, input.currency) },
      { label: "К оплате", value: formatInvoiceMoney(input.total, input.currency), grand: true },
    ];
  }
  const vatLabel =
    input.vatMode === "inclusive" ? "НДС включён в цены" : "НДС начислен сверху";
  return [
    { label: "Без НДС", value: formatInvoiceMoney(input.subtotalNet, input.currency) },
    {
      label: `${vatLabel} · ${formatPercent(input.vatPercent)}`,
      value: formatInvoiceMoney(input.vatAmount, input.currency),
    },
    { label: "К оплате", value: formatInvoiceMoney(input.total, input.currency), grand: true },
  ];
}

function primaryClientAddress(client: Client): string {
  const primary = client.locations.find((location) => location.isPrimary)
    ?? client.locations.find((location) => clean(location.address));
  return clean(primary?.address) || joinParts(client.address, client.city);
}

function prefixed(label: string, value: string): string {
  return value ? `${label}: ${value}` : "";
}

function compact(values: string[]): string[] {
  return values.filter((value) => value.length > 0);
}

function firstNonEmpty(...values: (string | null | undefined)[]): string {
  for (const value of values) {
    const normalized = clean(value);
    if (normalized) return normalized;
  }
  return "";
}

function joinParts(...values: (string | null | undefined)[]): string {
  return values.map(clean).filter(Boolean).join(", ");
}

function clean(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatQty(value: number): string {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(value);
}

function formatPercent(value: number): string {
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)}%`;
}
