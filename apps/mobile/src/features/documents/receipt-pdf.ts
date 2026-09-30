import type { Receipt } from "@babun/shared/local/finance/receipt";
import { escapeHtml } from "@/features/invoices/pdf";
import {
  buildReceiptDocument,
  type ReceiptDocument,
  type ReceiptLineItemsInput,
} from "./receipt-document";

// PDF ЧЕКА — ТА ЖЕ ТИПОГРАФИКА, ЧТО У ИНВОЙСА (`invoices/pdf.ts`), НО ЛИСТ
// МЕНЬШЕ. Владелец 2026-09-20: «в чеке должен быть перечень услуг с ценой, по
// сути как инвойс, но не инвойс» — поэтому таблица строк ниже шапки ЕСТЬ, но
// самого счёта (реквизиты оплаты, срок, статус расчёта) в чеке по-прежнему
// нет: чек подтверждает приём денег, а не просит их. `escapeHtml` берём
// готовый из инвойсного рендера — второй копии одной и той же функции
// экранирования в продукте быть не должно.
//
// ТОТ ЖЕ ВЛАДЕЛЕЦ, после показа чека со строками: «по сути чек: сверху номер
// чека, дата и можно также компания» — ни клиента, ни способа оплаты, ни
// штампа «Оплачено» бумага не несёт. Штамп остаётся ТОЛЬКО у аннулированного
// чека (`doc.voidLabel`) — это состояние документа, а не украшение.

export function buildReceiptPdfHtml(
  receipt: Receipt,
  lineItems?: ReceiptLineItemsInput,
): string {
  return renderReceiptHtml(buildReceiptDocument(receipt, lineItems));
}

function renderReceiptHtml(doc: ReceiptDocument): string {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <!-- ИМЯ ДОКУМЕНТА БЕРЁТ БРАУЗЕР ИМЕННО ОТСЮДА. На вебе печать идёт через
       скрытый iframe (см. share-pdf.ts), и без title файл уходил клиенту как
       about:blank.pdf либо с именем страницы CRM. Нативная ветка называет файл
       сама, но лишним это не будет и там. -->
  <title>Чек ${escapeHtml(doc.number)}</title>
  <style>
    @page { size: A4; margin: 48px; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      display: flex;
      justify-content: center;
      color: #172033;
      background: #ffffff;
      font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;
      font-size: 12px;
      line-height: 1.45;
      -webkit-print-color-adjust: exact;
    }
    .card { width: 100%; max-width: 380px; padding: 26px 26px 22px; border: 1px solid #e2e8f0; border-radius: 12px; }
    .seller-name { font-size: 15px; font-weight: 750; color: #111827; }
    .seller-line { margin-top: 2px; color: #64748b; font-size: 10.5px; }
    .eyebrow { margin-top: 18px; color: #64748b; font-size: 9px; font-weight: 700; letter-spacing: 1.1px; text-transform: uppercase; }
    h1 { margin: 3px 0 16px; color: #111827; font-size: 21px; letter-spacing: -0.3px; }
    .row { display: flex; justify-content: space-between; gap: 12px; padding: 7px 0; border-bottom: 1px solid #e8edf3; }
    .row .label { color: #64748b; }
    .row .value { color: #111827; font-weight: 600; text-align: right; }
    .lines { width: 100%; margin-top: 14px; border-collapse: collapse; }
    /* МНОГОСТРАНИЧНЫЙ ЧЕК НЕ РВЁТСЯ ПОСРЕДИ СТРОКИ. Тридцать позиций уходят
       на вторую страницу, и без этих правил она начиналась без шапки таблицы,
       а позиция разрезалась пополам (у инвойса правила уже были, у чека нет). */
    thead { display: table-header-group; }
    tr { break-inside: avoid; page-break-inside: avoid; }
    .amount-wrap { break-inside: avoid; page-break-inside: avoid; }
    .lines th { padding: 0 0 5px; border-bottom: 1px solid #cbd5e1; color: #64748b; font-size: 8.5px; font-weight: 700; letter-spacing: .5px; text-align: left; text-transform: uppercase; }
    .lines th.number { text-align: right; }
    .lines td { padding: 6px 0; border-bottom: 1px solid #e8edf3; vertical-align: top; font-size: 10.5px; }
    .lines .line-title { color: #111827; font-weight: 600; }
    .lines .number { text-align: right; white-space: nowrap; }
    .lines .total-cell { color: #111827; font-weight: 700; }
    .amount-wrap { margin: 16px 0 4px; padding: 14px 16px; border-radius: 12px; background: #f6f8fb; }
    .total-row { display: flex; justify-content: space-between; gap: 12px; padding: 3px 0; color: #64748b; font-size: 11px; }
    .total-row strong { color: #111827; font-weight: 600; }
    .amount-row { display: flex; justify-content: space-between; align-items: baseline; }
    .amount-row.with-totals-above { margin-top: 8px; padding-top: 10px; border-top: 1px dashed #d9e0e9; }
    .amount-label { color: #64748b; font-size: 11px; }
    .amount-value { color: #111827; font-size: 22px; font-weight: 800; }
    .stamp { margin-top: 20px; padding-top: 14px; border-top: 1px dashed #cbd5e1; text-align: center; font-size: 12px; font-weight: 700; letter-spacing: .5px; text-transform: uppercase; }
    .stamp.void { color: #b42318; }
  </style>
</head>
<body>
  <main class="card">
    <div class="seller-name">${escapeHtml(doc.seller.name)}</div>
    ${doc.seller.lines.map((line) => `<div class="seller-line">${escapeHtml(line)}</div>`).join("")}

    <div class="eyebrow">Чек</div>
    <h1>${escapeHtml(doc.number)}</h1>

    <div class="row"><span class="label">Дата</span><span class="value">${escapeHtml(doc.issuedOn)}</span></div>

    ${doc.lines.length > 0 ? `
    <table class="lines" aria-label="Перечень услуг">
      <thead>
        <tr><th>Услуга</th><th class="number">Кол-во</th><th class="number">Цена</th><th class="number">Сумма</th></tr>
      </thead>
      <tbody>${doc.lines.map((line) => `
        <tr>
          <td class="line-title">${escapeHtml(line.name)}</td>
          <td class="number">${escapeHtml(line.qty)}</td>
          <td class="number">${escapeHtml(line.unitPrice)}</td>
          <td class="number total-cell">${escapeHtml(line.sum)}</td>
        </tr>`).join("")}</tbody>
    </table>
    ` : ""}

    <div class="amount-wrap">
      ${doc.linesTotal ? `
      <div class="total-row"><span>Итого работ</span><strong>${escapeHtml(doc.linesTotal)}</strong></div>` : ""}
      ${doc.discount ? `
      <div class="total-row"><span>${escapeHtml(doc.discount.label)}</span><strong>${escapeHtml(doc.discount.value)}</strong></div>` : ""}
      ${doc.vat ? `
      <div class="total-row"><span>${escapeHtml(doc.vat.label)}</span><strong>${escapeHtml(doc.vat.value)}</strong></div>` : ""}
      <div class="amount-row${doc.linesTotal || doc.discount || doc.vat ? " with-totals-above" : ""}">
        <span class="amount-label">Получено</span>
        <span class="amount-value">${escapeHtml(doc.amount)}</span>
      </div>
    </div>

    ${doc.voidLabel ? `<div class="stamp void">${escapeHtml(doc.voidLabel)}</div>` : ""}
  </main>
</body>
</html>`;
}
