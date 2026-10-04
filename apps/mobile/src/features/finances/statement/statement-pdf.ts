import { shareHtmlAsPdf } from "@/features/documents/share-pdf";
import { escapeHtml } from "@/features/invoices/pdf";
import type { StatementDocument } from "./statement-document";

// PDF ВЫПИСКИ — ТЕ ЖЕ ЧЕРНИЛА, ЧТО У ЧЕКА (`documents/receipt-pdf.ts`), НО
// ЛИСТ ШИРЕ: строк много, и у каждой три колонки. Состав и порядок — ровно
// как у `StatementPaper.tsx` (стережёт `statement-paper-contract.test.ts`).

export function buildStatementPdfHtml(doc: StatementDocument): string {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Выписка ${escapeHtml(doc.accountName)}</title>
  <style>
    @page { size: A4; margin: 40px; }
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
    .card { width: 100%; max-width: 520px; padding: 26px 26px 22px; border: 1px solid #e2e8f0; border-radius: 12px; }
    .eyebrow { color: #64748b; font-size: 9px; font-weight: 700; letter-spacing: 1.1px; text-transform: uppercase; }
    h1 { margin: 3px 0 0; color: #111827; font-size: 21px; letter-spacing: -0.3px; }
    .team { margin-top: 2px; color: #64748b; font-size: 10.5px; }
    .rows { margin-top: 14px; }
    .row { display: flex; justify-content: space-between; gap: 12px; padding: 7px 0; border-bottom: 1px solid #e8edf3; }
    .row .label { color: #64748b; }
    .row .value { color: #111827; font-weight: 600; text-align: right; }
    .lines { width: 100%; margin-top: 14px; border-collapse: collapse; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; page-break-inside: avoid; }
    .lines th { padding: 0 0 5px; border-bottom: 1px solid #cbd5e1; color: #64748b; font-size: 8.5px; font-weight: 700; letter-spacing: .5px; text-align: left; text-transform: uppercase; }
    .lines th.number { text-align: right; }
    .lines td { padding: 6px 0; border-bottom: 1px solid #e8edf3; vertical-align: top; font-size: 10.5px; }
    .lines td.day { padding: 10px 0 4px; color: #64748b; font-size: 9.5px; font-weight: 700; border-bottom: 1px solid #e8edf3; }
    .lines .title { color: #111827; font-weight: 600; }
    .lines .detail { margin-top: 1px; color: #64748b; font-size: 9.5px; }
    .lines .number { text-align: right; white-space: nowrap; padding-left: 10px; }
    .lines .amount { color: #111827; font-weight: 700; }
    .lines .balance { color: #64748b; }
    .empty { margin-top: 14px; color: #64748b; font-size: 11px; }
    .amount-wrap { margin: 16px 0 4px; padding: 14px 16px; border-radius: 12px; background: #f6f8fb; break-inside: avoid; page-break-inside: avoid; }
    .total-row { display: flex; justify-content: space-between; gap: 12px; padding: 3px 0; color: #64748b; font-size: 11px; }
    .total-row strong { color: #111827; font-weight: 600; }
    .amount-row { display: flex; justify-content: space-between; align-items: baseline; margin-top: 8px; padding-top: 10px; border-top: 1px dashed #d9e0e9; }
    .amount-label { color: #64748b; font-size: 11px; }
    .amount-value { color: #111827; font-size: 22px; font-weight: 800; }
  </style>
</head>
<body>
  <main class="card">
    <div class="eyebrow">Выписка по счёту</div>
    <h1>${escapeHtml(doc.accountName)}</h1>
    ${doc.teamName ? `<div class="team">${escapeHtml(doc.teamName)}</div>` : ""}

    <div class="rows">
      <div class="row"><span class="label">Период</span><span class="value">${escapeHtml(doc.period)}</span></div>
      <div class="row"><span class="label">Остаток на начало</span><span class="value">${escapeHtml(doc.opening)}</span></div>
    </div>

    ${doc.days.length > 0 ? `
    <table class="lines" aria-label="Операции">
      <thead>
        <tr><th>Операция</th><th class="number">Сумма</th><th class="number">Остаток</th></tr>
      </thead>
      <tbody>${doc.days.map((day) => `
        <tr><td class="day" colspan="3">${escapeHtml(day.date)}</td></tr>${day.rows.map((row) => `
        <tr>
          <td><div class="title">${escapeHtml(row.title)}</div>${row.detail ? `<div class="detail">${escapeHtml(row.detail)}</div>` : ""}</td>
          <td class="number amount">${escapeHtml(row.amount)}</td>
          <td class="number balance">${escapeHtml(row.balance)}</td>
        </tr>`).join("")}`).join("")}</tbody>
    </table>
    ` : `<div class="empty">Операций не было</div>`}

    <div class="amount-wrap">
      <div class="total-row"><span>Поступило</span><strong>${escapeHtml(doc.income)}</strong></div>
      <div class="total-row"><span>Списано</span><strong>${escapeHtml(doc.expense)}</strong></div>
      <div class="amount-row">
        <span class="amount-label">Остаток на конец</span>
        <span class="amount-value">${escapeHtml(doc.closing)}</span>
      </div>
    </div>
  </main>
</body>
</html>`;
}

/** Лист — в системное «Поделиться» PDF-файлом «Выписка Kasa 01.10.2026 — 31.10.2026.pdf». */
export async function shareStatementPdf(doc: StatementDocument): Promise<void> {
  // Период в имени файла: бухгалтер получает выписки за разные кварталы, и
  // «Выписка Kasa» трижды подряд в одной переписке ничего не говорит.
  const title = `Выписка ${doc.accountName} ${doc.period}`;
  await shareHtmlAsPdf({ html: buildStatementPdfHtml(doc), fileName: title, dialogTitle: title });
}
