import type { Client } from "@babun/shared/local/clients";
import { paymentMethodLabel } from "@babun/shared/local/finance/transaction";
import {
  invoiceDisplayStatus,
  invoiceLineTotal,
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
import {
  invoiceDictionary,
  type InvoiceDictionary,
  type InvoiceLanguage,
} from "./dictionary";

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
  /** Что входит в работу — печатается второй строкой под названием. */
  description: string | null;
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
  /** Словарь, которым набран этот документ. Рендеры (экранная бумага и PDF)
   *  берут ВСЕ свои заголовки отсюда: иначе половина счёта осталась бы
   *  по-русски там, где её зашили в разметку. */
  dict: InvoiceDictionary;
}

export interface InvoiceDocumentDraft {
  number: string;
  issuedOn: string;
  dueOn: string | null;
  clientId: string | null;
  lines: readonly {
    title: string;
    qty: number;
    unitPrice: number;
    description?: string | null;
    /** Единица количества: «4 м». `null`/пусто — печатается голое число. */
    unit?: string | null;
  }[];
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
  /** Язык БУМАГИ, не приложения. Русский по умолчанию. */
  language?: InvoiceLanguage;
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
  language,
}: IssuedDocumentInput): InvoiceDocument {
  const dict = invoiceDictionary(language);
  const displayStatus = invoiceDisplayStatus(invoice, businessToday, settlement);
  const seller = invoice.seller_snapshot;
  const recipient = invoice.client_snapshot;
  // Снимок — это ВЕСЬ юридический источник, включая поля, намеренно пустые на
  // момент выставления. Дополнять его живым профилем нельзя: переименовали
  // компанию — и старый документ бесшумно переписался бы.
  const sellerName = seller
    ? firstNonEmpty(seller.legal_name, seller.name, seller.display_name)
      || dict.sellerMissing
    : firstNonEmpty(tenant?.legal_name, tenant?.name) || dict.sellerMissing;
  const vatMode = invoiceVatMode(invoice);

  return {
    number: invoice.number,
    draft: false,
    dict,
    // Статус — часть бумаги, значит тоже на её языке. Общий словарь
    // `INVOICE_STATUS_LABELS` остаётся для СПИСКОВ приложения: там русский
    // всегда, потому что списки читает владелец, а не клиент.
    statusLabel: dict[`status_${displayStatus}`],
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
        || dict.recipientMissing,
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
    issuedOn: formatInvoiceDate(invoice.issued_on, dict.locale, dict.notSet),
    dueOn: formatInvoiceDate(invoice.due_on, dict.locale, dict.notSet),
    lines: invoice.lines.map((line) => ({
      title: line.title,
      description: line.description?.trim() || null,
      qty: formatQty(line.qty, line.unit, dict.locale),
      unitPrice: formatInvoiceMoney(line.unit_price, invoice.currency, dict.locale),
      total: formatInvoiceMoney(line.total, invoice.currency, dict.locale),
    })),
    totals: totalRows({
      dict,
      currency: invoice.currency,
      subtotalNet: invoice.subtotal_net,
      vatAmount: invoice.vat_amount,
      vatPercent: invoice.vat_percent,
      vatMode,
      total: invoice.total,
    }),
    payTo: compact([
      prefixed("IBAN", seller ? clean(seller.iban) : clean(tenant?.iban)),
      prefixed(dict.bank, seller ? clean(seller.bank_name) : clean(tenant?.bank_name)),
    ]),
    settlement: [
      {
        label: dict.paid,
        value: formatInvoiceMoney(settlement.paid, invoice.currency, dict.locale),
      },
      {
        label: dict.remaining,
        value: formatInvoiceMoney(settlement.remaining, invoice.currency, dict.locale),
      },
    ],
    payments: payments.map((payment) => {
      const account = payment.account_id ? accountNames?.get(payment.account_id) : undefined;
      const method = paymentMethodLabel(payment.payment_method);
      const refund = payment.type === "refund";
      return {
        date: formatInvoiceDate(payment.occurred_on),
        title: refund ? dict.refundRow : dict.paymentRow,
        details: [account, method].filter(Boolean).join(" · "),
        amount: `${refund ? "−" : ""}${formatInvoiceMoney(Math.abs(payment.amount), invoice.currency)}`,
        refund,
      };
    }),
    notes: clean(invoice.notes),
    footer: `Документ сформирован из данных инвойса ${invoice.number}. Валюта: ${invoice.currency}.`,
  };
}

function draftDocument({
  draft,
  tenant,
  client,
  language,
}: DraftDocumentInput): InvoiceDocument {
  const dict = invoiceDictionary(language);
  return {
    number: draft.number,
    draft: true,
    dict,
    statusLabel: dict.draft,
    logoUrl: clean(tenant?.logo_url) || null,
    seller: {
      name: firstNonEmpty(tenant?.legal_name, tenant?.name) || dict.sellerMissing,
      lines: compact([
        firstNonEmpty(tenant?.business_address, joinParts(tenant?.address, tenant?.city)),
        prefixed("VAT", clean(tenant?.vat_number)),
        clean(tenant?.contact_email),
        clean(tenant?.contact_phone),
      ]),
    },
    client: {
      name: clean(client?.full_name) || dict.recipientMissing,
      lines: compact([
        client ? primaryClientAddress(client) : "",
        clean(client?.email),
        clean(client?.phone),
      ]),
    },
    issuedOn: formatInvoiceDate(draft.issuedOn, dict.locale, dict.notSet),
    dueOn: formatInvoiceDate(draft.dueOn, dict.locale, dict.notSet),
    lines: draft.lines.map((line) => ({
      title: line.title,
      description: line.description?.trim() || null,
      qty: formatQty(line.qty, line.unit, dict.locale),
      unitPrice: formatInvoiceMoney(line.unitPrice, draft.currency, dict.locale),
      // ОДИН СЧЁТ НА ВЕСЬ ПРОДУКТ: своё `round2(qty * price)` в double
      // печатало в строке 3,01 там, где итог документа (и сервер) говорят
      // 3,02 — на одном экране два разных числа за одну и ту же позицию.
      total: formatInvoiceMoney(
        invoiceLineTotal(line.qty, line.unitPrice),
        draft.currency,
        dict.locale,
      ),
    })),
    totals: totalRows({
      dict,
      currency: draft.currency,
      subtotalNet: draft.subtotalNet,
      vatAmount: draft.vatAmount,
      vatPercent: draft.vatPercent,
      vatMode: draft.vatMode,
      total: draft.total,
    }),
    payTo: compact([
      prefixed("IBAN", clean(tenant?.iban)),
      prefixed(dict.bank, clean(tenant?.bank_name)),
    ]),
    // У черновика платить ещё нечего — блок оплаты не печатаем вовсе.
    settlement: [],
    payments: [],
    notes: clean(draft.notes),
    footer: dict.draftFooter(draft.number),
  };
}

function totalRows(input: {
  dict: InvoiceDictionary;
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
    const { dict } = input;
    return [
      {
        label: dict.subtotal,
        value: formatInvoiceMoney(input.subtotalNet, input.currency, dict.locale),
      },
      {
        label: dict.grandTotal,
        value: formatInvoiceMoney(input.total, input.currency, dict.locale),
        grand: true,
      },
    ];
  }
  const { dict } = input;
  const vatLabel =
    input.vatMode === "inclusive" ? dict.vatInclusive : dict.vatExclusive;
  return [
    {
      label: dict.netAmount,
      value: formatInvoiceMoney(input.subtotalNet, input.currency, dict.locale),
    },
    {
      label: `${vatLabel} · ${formatPercent(input.vatPercent, dict.locale)}`,
      value: formatInvoiceMoney(input.vatAmount, input.currency, dict.locale),
    },
    {
      label: dict.grandTotal,
      value: formatInvoiceMoney(input.total, input.currency, dict.locale),
      grand: true,
    },
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

/** «4 м» вместо голого «4» (2026-08-25). Колонка «Кол-во» печатала число без
 *  подписи, и на проде это уже вышло боком: человек вписал метры в НАЗВАНИЕ
 *  позиции — «Трасса, 4 м», — потому что сказать их было больше негде.
 *  Единица берётся из СТРОКИ СЧЁТА, а не из прайса: выставленный документ
 *  заморожен, и смена единицы у услуги через месяц не переписывает бумагу,
 *  которую клиент уже получил. */
function formatQty(
  value: number,
  unit?: string | null,
  locale = "ru-RU",
): string {
  const number = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 3,
  }).format(value);
  const suffix = unit?.trim();
  return suffix ? `${number} ${suffix}` : number;
}

function formatPercent(value: number, locale = "ru-RU"): string {
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value)}%`;
}
