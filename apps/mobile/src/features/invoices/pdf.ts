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

function renderInvoiceHtml(doc: InvoiceDocument): string {
  // ВИД — КАК У ИНВОЙСА AIRFIX #103 (владелец 2026-09-22), тот же, что у
  // экранной `InvoicePaper`: логотип слева, INVOICE и номер справа, FROM и
  // BILL TO колонками, таблица в рамке, итоги столбиком, внизу «Notes &
  // payment instructions» и номер документа. Оба рендера правятся вместе.
  const lineRows = doc.lines.map((line) => `
    <tr>
      <td class="line-title">${escapeHtml(line.title || doc.dict.untitled)}${
        line.description
          ? `<div class="muted small">${escapeHtml(line.description)}</div>`
          : ""
      }</td>
      <td class="number">${escapeHtml(line.qty)}</td>
      <td class="number">${escapeHtml(line.unitPrice)}</td>
      <td class="number">${escapeHtml(line.total)}</td>
    </tr>`).join("");

  const paymentRows = doc.payments.map((payment) => `
      <tr>
        <td>${escapeHtml(payment.date)}</td>
        <td>${escapeHtml(payment.title)}${payment.details ? ` · ${escapeHtml(payment.details)}` : ""}</td>
        <td class="number ${payment.refund ? "refund" : "payment"}">${escapeHtml(payment.amount)}</td>
      </tr>`).join("");

  const totalRows = doc.totals.map((total) => `
        <tr class="${total.grand ? "grand" : ""}">
          <td class="total-label">${escapeHtml(total.label)}</td>
          <td class="total-value">${escapeHtml(total.value)}</td>
        </tr>`).join("");

  const party = (title: string, name: string, lines: string[]) => `
      <div class="party">
        <div class="eyebrow">${escapeHtml(title)}</div>
        <div class="party-name">${escapeHtml(name)}</div>
        ${lines.map((line) => `<div class="detail">${escapeHtml(line)}</div>`).join("")}
      </div>`;

  const noteLines = [...doc.payTo, ...(doc.notes ? [doc.notes] : [])];

  return `<!doctype html>
<html lang="${doc.dict.locale.slice(0, 2)}">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(doc.dict.invoiceEyebrow)} ${escapeHtml(doc.number)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    @page { size: A4; margin: 40px 44px 44px; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #374151;
      background: #ffffff;
      font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;
      font-size: 13px;
      line-height: 1.45;
      -webkit-print-color-adjust: exact;
    }
    .page { width: 100%; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 28px; margin-bottom: 18px; }
    .logo { max-width: 120px; max-height: 120px; }
    .doc { text-align: right; }
    h1 { margin: 0 0 8px; color: #111827; font-size: 30px; font-weight: 800; letter-spacing: 0.3px; }
    .doc-line { color: #6b7280; font-size: 14px; margin-top: 2px; }
    .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; margin-bottom: 26px; }
    .eyebrow { color: #374151; font-size: 10px; font-weight: 700; letter-spacing: .6px; text-transform: uppercase; }
    .party-name { margin: 10px 0 4px; color: #111827; font-size: 17px; font-weight: 700; }
    .detail { color: #374151; margin-top: 2px; overflow-wrap: anywhere; }
    table.lines { width: 100%; border-collapse: collapse; border: 1px solid #e5e7eb; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; page-break-inside: avoid; }
    .lines th { padding: 12px; background: #f3f4f6; border: 1px solid #e5e7eb; color: #111827; font-size: 14px; font-weight: 600; text-align: right; }
    .lines th:first-child { text-align: left; }
    .lines td { padding: 12px; font-size: 14px; border: 1px solid #e5e7eb; vertical-align: top; }
    .line-title { color: #111827; font-weight: 600; font-size: 15px; }
    .col-qty { width: 56px; }
    .col-money { width: 124px; }
    .lines th { white-space: nowrap; }
    .number { text-align: right; white-space: nowrap; }
    .totals { margin-left: auto; margin-top: 8px; border-collapse: collapse; }
    .totals td { padding: 3px 12px; font-size: 14px; }
    .total-label { text-align: right; color: #374151; }
    .total-value { width: 124px; text-align: right; font-weight: 600; color: #111827; }
    .grand td { padding: 10px 12px; font-size: 17px; font-weight: 700; color: #111827; }
    .grand .total-value { border: 1px solid #e5e7eb; }
    .section { margin-top: 26px; break-inside: avoid; }
    .section .eyebrow { margin-bottom: 6px; }
    .note { white-space: pre-wrap; color: #374151; margin-top: 2px; }
    table.payments { width: 100%; border-collapse: collapse; }
    .payments td { padding: 6px 0; border-bottom: 1px solid #e5e7eb; }
    .payment { color: #047857; font-weight: 700; }
    .refund { color: #b91c1c; font-weight: 700; }
    .footer { margin-top: 40px; color: #9ca3af; font-size: 11px; text-align: right; }
    .muted { color: #6b7280; }
    .small { margin-top: 2px; font-size: 12px; font-weight: 400; }
  </style>
</head>
<body>
  <main class="page">
    <header class="header">
      <div>${doc.logoUrl ? `<img class="logo" src="${escapeHtml(doc.logoUrl)}" alt="" />` : ""}</div>
      <div class="doc">
        <h1>${escapeHtml(doc.dict.invoice)}</h1>
        <div class="doc-line">${escapeHtml(doc.number)}</div>
        <div class="doc-line">${escapeHtml(doc.dict.issuedShort(doc.issuedShort))}</div>
        ${doc.dueShort ? `<div class="doc-line">${escapeHtml(doc.dict.dueShort(doc.dueShort))}</div>` : ""}
      </div>
    </header>

    <section class="parties">
      ${party(doc.dict.seller, doc.seller.name, doc.seller.lines)}
      ${party(doc.dict.recipient, doc.client.name, doc.client.lines)}
    </section>

    <table class="lines" aria-label="${escapeHtml(doc.dict.linesTableLabel)}">
      <thead>
        <tr><th>${escapeHtml(doc.dict.lineTitle)}</th><th class="col-qty">${escapeHtml(doc.dict.qty)}</th><th class="col-money">${escapeHtml(doc.dict.price)}, ${escapeHtml(doc.currency)}</th><th class="col-money">${escapeHtml(doc.dict.amount)}, ${escapeHtml(doc.currency)}</th></tr>
      </thead>
      <tbody>${lineRows || `
        <tr><td colspan="4" class="muted">${escapeHtml(doc.dict.linesEmpty)}</td></tr>
      `}</tbody>
    </table>

    <table class="totals"><tbody>${totalRows}</tbody></table>

    ${noteLines.length > 0 ? `
      <section class="section">
        <div class="eyebrow">${escapeHtml(doc.dict.notesAndPayment)}</div>
        ${doc.payTo.map((line) => `<div class="detail">${escapeHtml(line)}</div>`).join("")}
        ${doc.notes ? `<div class="note">${escapeHtml(doc.notes)}</div>` : ""}
      </section>
    ` : ""}

    ${paymentRows ? `
      <section class="section">
        <div class="eyebrow">${escapeHtml(doc.dict.payment)}</div>
        <table class="payments" aria-label="${escapeHtml(doc.dict.paymentsTableLabel)}"><tbody>${paymentRows}</tbody></table>
      </section>
    ` : ""}

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
