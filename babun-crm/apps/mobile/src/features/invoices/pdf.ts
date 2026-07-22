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

type InvoicePdfInput = {
  invoice: InvoiceLedgerWithLines;
  tenant?: Tenant;
  client?: Client;
  settlement: InvoiceSettlement;
  payments: readonly InvoicePaymentLedger[];
  accountNames?: ReadonlyMap<string, string>;
  businessToday?: string;
};

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  cash: "Наличные",
  card: "Карта",
  transfer: "Перевод",
  other: "Другое",
};

export function buildInvoicePdfHtml({
  invoice,
  tenant,
  client,
  settlement,
  payments,
  accountNames,
  businessToday,
}: InvoicePdfInput): string {
  const displayStatus = invoiceDisplayStatus(invoice, businessToday, settlement);
  const seller = invoice.seller_snapshot;
  const recipient = invoice.client_snapshot;
  // Once a snapshot exists it is the whole legal source, including fields
  // that were intentionally blank on issue. Falling through field-by-field
  // to a renamed live profile would silently rewrite an old document.
  const sellerName = seller
    ? firstNonEmpty(seller.legal_name, seller.name, seller.display_name)
      || "Продавец не указан"
    : firstNonEmpty(tenant?.legal_name, tenant?.name) || "Продавец не указан";
  const sellerAddress = seller
    ? firstNonEmpty(seller.address, seller.business_address)
    : firstNonEmpty(tenant?.business_address, joinParts(tenant?.address, tenant?.city));
  const clientName = recipient
    ? clean(recipient.full_name)
    : clean(client?.full_name);
  const clientAddress = recipient
    ? firstNonEmpty(recipient.primary_address, recipient.address)
    : client
      ? primaryClientAddress(client)
      : "";
  const clientEmail = recipient ? clean(recipient.email) : clean(client?.email);
  const clientPhone = recipient ? clean(recipient.phone) : clean(client?.phone);
  const sellerEmail = seller ? clean(seller.contact_email) : clean(tenant?.contact_email);
  const sellerPhone = seller ? clean(seller.contact_phone) : clean(tenant?.contact_phone);
  const sellerVat = seller ? clean(seller.vat_number) : clean(tenant?.vat_number);
  const sellerIban = seller ? clean(seller.iban) : clean(tenant?.iban);
  const sellerBank = seller ? clean(seller.bank_name) : clean(tenant?.bank_name);
  const vatMode = invoiceVatMode(invoice);
  const vatModeLabel = vatMode === "inclusive"
    ? "VAT включён в цены"
    : vatMode === "exclusive"
      ? "VAT начислен сверху"
      : "Без VAT";

  const lineRows = invoice.lines.map((line, index) => `
    <tr>
      <td class="line-number">${index + 1}</td>
      <td class="line-title">${escapeHtml(line.title)}</td>
      <td class="number">${formatQty(line.qty)}</td>
      <td class="number">${escapeHtml(formatInvoiceMoney(line.unit_price, invoice.currency))}</td>
      <td class="number total-cell">${escapeHtml(formatInvoiceMoney(line.total, invoice.currency))}</td>
    </tr>`).join("");

  const paymentRows = payments.map((payment) => {
    const account = payment.account_id ? accountNames?.get(payment.account_id) : undefined;
    const method = payment.payment_method
      ? PAYMENT_METHOD_LABEL[payment.payment_method] ?? payment.payment_method
      : "";
    const details = [account, method].filter(Boolean).join(" · ");
    const isRefund = payment.type === "refund";
    const amount = `${isRefund ? "−" : ""}${formatInvoiceMoney(Math.abs(payment.amount), invoice.currency)}`;
    return `
      <tr>
        <td>${escapeHtml(formatInvoiceDate(payment.occurred_on))}</td>
        <td>${isRefund ? "Возврат" : "Платёж"}${details ? `<div class="muted small">${escapeHtml(details)}</div>` : ""}</td>
        <td class="number ${isRefund ? "refund" : "payment"}">${escapeHtml(amount)}</td>
      </tr>`;
  }).join("");

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    @page { size: A4; margin: 34px 38px 42px; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #172033;
      background: #ffffff;
      font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;
      font-size: 11px;
      line-height: 1.42;
      -webkit-print-color-adjust: exact;
    }
    .page { width: 100%; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 28px; margin-bottom: 26px; }
    .brand { max-width: 58%; }
    .brand-name { font-size: 20px; font-weight: 750; letter-spacing: -0.2px; color: #111827; margin-bottom: 5px; }
    .doc { text-align: right; }
    .eyebrow { color: #64748b; font-size: 9px; font-weight: 700; letter-spacing: 1.15px; text-transform: uppercase; }
    h1 { margin: 3px 0 5px; color: #111827; font-size: 25px; line-height: 1.12; letter-spacing: -0.45px; }
    .status { display: inline-block; padding: 4px 9px; border-radius: 999px; background: #eef3ff; color: #3157a4; font-size: 9px; font-weight: 700; }
    .party-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 22px; }
    .party { min-height: 112px; padding: 14px 15px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff; }
    .party-title { margin-bottom: 7px; color: #64748b; font-size: 9px; font-weight: 700; letter-spacing: .8px; text-transform: uppercase; }
    .party-name { margin-bottom: 5px; color: #111827; font-size: 13px; font-weight: 700; }
    .detail { color: #475569; margin-top: 2px; overflow-wrap: anywhere; }
    table { width: 100%; border-collapse: collapse; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; page-break-inside: avoid; }
    th { padding: 9px 8px; border-bottom: 1px solid #cbd5e1; color: #64748b; font-size: 9px; font-weight: 700; letter-spacing: .45px; text-align: left; text-transform: uppercase; }
    td { padding: 10px 8px; border-bottom: 1px solid #e8edf3; vertical-align: top; }
    .line-number { width: 24px; color: #94a3b8; }
    .line-title { color: #111827; font-weight: 600; }
    .number { text-align: right; white-space: nowrap; }
    .total-cell { color: #111827; font-weight: 700; }
    .totals-wrap { display: flex; justify-content: flex-end; margin: 15px 0 22px; }
    .totals { width: 265px; padding: 12px 15px; border-radius: 12px; background: #f6f8fb; }
    .total-row { display: flex; justify-content: space-between; gap: 18px; padding: 4px 0; }
    .grand-total { margin-top: 7px; padding-top: 10px; border-top: 1px solid #d9e0e9; color: #111827; font-size: 15px; font-weight: 800; }
    .section { margin-top: 19px; break-inside: avoid; }
    .section h2 { margin: 0 0 8px; color: #111827; font-size: 13px; }
    .settlement { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 9px; }
    .metric { padding: 10px 11px; border: 1px solid #e2e8f0; border-radius: 10px; }
    .metric-label { color: #64748b; font-size: 9px; }
    .metric-value { margin-top: 3px; color: #111827; font-size: 12px; font-weight: 750; }
    .payment { color: #16794b; font-weight: 700; }
    .refund { color: #b42318; font-weight: 700; }
    .notes { padding: 12px 14px; border-left: 3px solid #9db4e2; border-radius: 3px 10px 10px 3px; background: #f6f8fb; color: #334155; white-space: pre-wrap; }
    .footer { margin-top: 28px; padding-top: 11px; border-top: 1px solid #e2e8f0; color: #94a3b8; font-size: 8px; }
    .muted { color: #64748b; }
    .small { margin-top: 2px; font-size: 9px; }
  </style>
</head>
<body>
  <main class="page">
    <header class="header">
      <div class="brand">
        <div class="brand-name">${escapeHtml(sellerName)}</div>
        ${sellerAddress ? `<div class="detail">${escapeHtml(sellerAddress)}</div>` : ""}
        ${sellerEmail ? `<div class="detail">${escapeHtml(sellerEmail)}</div>` : ""}
        ${sellerPhone ? `<div class="detail">${escapeHtml(sellerPhone)}</div>` : ""}
      </div>
      <div class="doc">
        <div class="eyebrow">Инвойс</div>
        <h1>${escapeHtml(invoice.number)}</h1>
        <span class="status">${escapeHtml(INVOICE_STATUS_LABELS[displayStatus])}</span>
      </div>
    </header>

    <section class="party-grid">
      <div class="party">
        <div class="party-title">Продавец</div>
        <div class="party-name">${escapeHtml(sellerName)}</div>
        ${sellerVat ? `<div class="detail">VAT: ${escapeHtml(sellerVat)}</div>` : ""}
        ${sellerIban ? `<div class="detail">IBAN: ${escapeHtml(sellerIban)}</div>` : ""}
        ${sellerBank ? `<div class="detail">Банк: ${escapeHtml(sellerBank)}</div>` : ""}
      </div>
      <div class="party">
        <div class="party-title">Получатель</div>
        ${clientName ? `
          <div class="party-name">${escapeHtml(clientName)}</div>
          ${clientAddress ? `<div class="detail">${escapeHtml(clientAddress)}</div>` : ""}
          ${clientEmail ? `<div class="detail">${escapeHtml(clientEmail)}</div>` : ""}
          ${clientPhone ? `<div class="detail">${escapeHtml(clientPhone)}</div>` : ""}
        ` : `<div class="party-name">Получатель не указан</div>`}
      </div>
    </section>

    <section class="party-grid">
      <div class="party" style="min-height:0">
        <div class="party-title">Дата выставления</div>
        <div class="party-name">${escapeHtml(formatInvoiceDate(invoice.issued_on))}</div>
      </div>
      <div class="party" style="min-height:0">
        <div class="party-title">Оплатить до</div>
        <div class="party-name">${escapeHtml(formatInvoiceDate(invoice.due_on))}</div>
      </div>
    </section>

    <table aria-label="Позиции инвойса">
      <thead>
        <tr><th></th><th>Позиция</th><th class="number">Кол-во</th><th class="number">Цена</th><th class="number">Сумма</th></tr>
      </thead>
      <tbody>${lineRows}</tbody>
    </table>

    <div class="totals-wrap">
      <div class="totals">
        <div class="total-row"><span>Без VAT</span><strong>${escapeHtml(formatInvoiceMoney(invoice.subtotal_net, invoice.currency))}</strong></div>
        <div class="total-row"><span>${escapeHtml(vatModeLabel)}${invoice.vat_amount > 0 ? ` · ${formatPercent(invoice.vat_percent)}` : ""}</span><strong>${escapeHtml(formatInvoiceMoney(invoice.vat_amount, invoice.currency))}</strong></div>
        <div class="total-row grand-total"><span>К оплате</span><span>${escapeHtml(formatInvoiceMoney(invoice.total, invoice.currency))}</span></div>
      </div>
    </div>

    <section class="section">
      <h2>Оплата</h2>
      <div class="settlement">
        <div class="metric"><div class="metric-label">Статус</div><div class="metric-value">${escapeHtml(INVOICE_STATUS_LABELS[displayStatus])}</div></div>
        <div class="metric"><div class="metric-label">Оплачено</div><div class="metric-value">${escapeHtml(formatInvoiceMoney(settlement.paid, invoice.currency))}</div></div>
        <div class="metric"><div class="metric-label">Остаток</div><div class="metric-value">${escapeHtml(formatInvoiceMoney(settlement.remaining, invoice.currency))}</div></div>
      </div>
      ${paymentRows ? `
        <table aria-label="История платежей">
          <thead><tr><th>Дата</th><th>Операция</th><th class="number">Сумма</th></tr></thead>
          <tbody>${paymentRows}</tbody>
        </table>
      ` : `<div class="muted">Подтверждённых операций оплаты пока нет.</div>`}
    </section>

    ${invoice.notes ? `<section class="section"><h2>Комментарий</h2><div class="notes">${escapeHtml(invoice.notes)}</div></section>` : ""}

    <footer class="footer">Документ сформирован из данных инвойса ${escapeHtml(invoice.number)}. Валюта: ${escapeHtml(invoice.currency)}.</footer>
  </main>
</body>
</html>`;
}

function primaryClientAddress(client: Client): string {
  const primary = client.locations.find((location) => location.isPrimary)
    ?? client.locations.find((location) => clean(location.address));
  return clean(primary?.address) || joinParts(client.address, client.city);
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

function formatQty(value: number): string {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(value);
}

function formatPercent(value: number): string {
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)}%`;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
