import {
  buildInvoiceDocument,
  type DraftDocumentInput,
  type InvoiceDocument,
  type IssuedDocumentInput,
} from "./document";

// PDF — ЭТО ТОТ ЖЕ ДОКУМЕНТ, ЧТО НА ЭКРАНЕ.
//
// Раньше здесь и собирались данные, и рисовалась разметка. Теперь сборка живёт
// в document.ts, а тут остаётся только рисование: экранное «зеркало» берёт ту
// же модель и печатает её компонентами RN. Одна модель — один документ, что бы
// человек ни открыл.

export function buildInvoicePdfHtml(
  input: IssuedDocumentInput | DraftDocumentInput,
): string {
  return renderInvoiceHtml(buildInvoiceDocument(input));
}

export function renderInvoiceHtml(doc: InvoiceDocument): string {
  const lineRows = doc.lines.map((line, index) => `
    <tr>
      <td class="line-number">${index + 1}</td>
      <td class="line-title">${escapeHtml(line.title)}</td>
      <td class="number">${escapeHtml(line.qty)}</td>
      <td class="number">${escapeHtml(line.unitPrice)}</td>
      <td class="number total-cell">${escapeHtml(line.total)}</td>
    </tr>`).join("");

  const paymentRows = doc.payments.map((payment) => `
      <tr>
        <td>${escapeHtml(payment.date)}</td>
        <td>${escapeHtml(payment.title)}${payment.details ? `<div class="muted small">${escapeHtml(payment.details)}</div>` : ""}</td>
        <td class="number ${payment.refund ? "refund" : "payment"}">${escapeHtml(payment.amount)}</td>
      </tr>`).join("");

  const totalRows = doc.totals.map((total) => `
        <div class="total-row${total.grand ? " grand-total" : ""}">
          <span>${escapeHtml(total.label)}</span>
          <strong>${escapeHtml(total.value)}</strong>
        </div>`).join("");

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
    .logo { max-width: 190px; max-height: 64px; margin-bottom: 8px; }
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
        ${doc.logoUrl ? `<img class="logo" src="${escapeHtml(doc.logoUrl)}" alt="" />` : ""}
        <div class="brand-name">${escapeHtml(doc.seller.name)}</div>
        ${doc.seller.lines.map((line) => `<div class="detail">${escapeHtml(line)}</div>`).join("")}
      </div>
      <div class="doc">
        <div class="eyebrow">Инвойс</div>
        <h1>${escapeHtml(doc.number)}</h1>
        <span class="status">${escapeHtml(doc.statusLabel)}</span>
      </div>
    </header>

    <section class="party-grid">
      <div class="party">
        <div class="party-title">Продавец</div>
        <div class="party-name">${escapeHtml(doc.seller.name)}</div>
        ${doc.seller.lines.map((line) => `<div class="detail">${escapeHtml(line)}</div>`).join("")}
      </div>
      <div class="party">
        <div class="party-title">Получатель</div>
        <div class="party-name">${escapeHtml(doc.client.name)}</div>
        ${doc.client.lines.map((line) => `<div class="detail">${escapeHtml(line)}</div>`).join("")}
      </div>
    </section>

    <section class="party-grid">
      <div class="party" style="min-height:0">
        <div class="party-title">Дата выставления</div>
        <div class="party-name">${escapeHtml(doc.issuedOn)}</div>
      </div>
      <div class="party" style="min-height:0">
        <div class="party-title">Оплатить до</div>
        <div class="party-name">${escapeHtml(doc.dueOn)}</div>
      </div>
    </section>

    <table aria-label="Позиции инвойса">
      <thead>
        <tr><th></th><th>Позиция</th><th class="number">Кол-во</th><th class="number">Цена</th><th class="number">Сумма</th></tr>
      </thead>
      <tbody>${lineRows}</tbody>
    </table>

    <div class="totals-wrap">
      <div class="totals">${totalRows}</div>
    </div>

    ${doc.payTo.length > 0 ? `
      <section class="section">
        <h2>Реквизиты для оплаты</h2>
        ${doc.payTo.map((line) => `<div class="detail">${escapeHtml(line)}</div>`).join("")}
        <div class="muted small">В назначении платежа укажите ${escapeHtml(doc.number)}.</div>
      </section>
    ` : ""}

    ${doc.settlement.length > 0 ? `
      <section class="section">
        <h2>Оплата</h2>
        <div class="settlement">
          <div class="metric"><div class="metric-label">Статус</div><div class="metric-value">${escapeHtml(doc.statusLabel)}</div></div>
          ${doc.settlement.map((metric) => `
            <div class="metric"><div class="metric-label">${escapeHtml(metric.label)}</div><div class="metric-value">${escapeHtml(metric.value)}</div></div>
          `).join("")}
        </div>
        ${paymentRows ? `
          <table aria-label="История платежей">
            <thead><tr><th>Дата</th><th>Операция</th><th class="number">Сумма</th></tr></thead>
            <tbody>${paymentRows}</tbody>
          </table>
        ` : `<div class="muted">Подтверждённых операций оплаты пока нет.</div>`}
      </section>
    ` : ""}

    ${doc.notes ? `<section class="section"><h2>Комментарий</h2><div class="notes">${escapeHtml(doc.notes)}</div></section>` : ""}

    <footer class="footer">${escapeHtml(doc.footer)}</footer>
  </main>
</body>
</html>`;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
