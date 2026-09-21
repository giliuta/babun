import type { InvoiceDocument } from "./document";

// ТЕКСТ ИНВОЙСА ДЛЯ КЛИЕНТА — то, что уходит в WhatsApp или почтой.
//
// СОБИРАЕТСЯ ИЗ ТОЙ ЖЕ МОДЕЛИ, ЧТО PDF И ЭКРАН (`buildInvoiceDocument`), тем
// же приёмом, что у чека (`documents/receipt-text.ts`). Раньше он считал
// состав САМ: печатал клиента и его адрес, говорил «Итого» там, где бумага
// говорит «К оплате», форматировал дату своим форматтером и звал налог
// по-своему. За одну отправку человек получал сообщение и вложение, которые
// расходились словами (аудит бумаги 2026-09-20).
//
// ЯЗЫК ПРИХОДИТ ВМЕСТЕ С ДОКУМЕНТОМ. `doc.dict` выбран при сборке по языку
// инвойса, поэтому английский счёт уходит английским сообщением, а не
// русским с английским вложением.
export function buildInvoiceShareText(doc: InvoiceDocument): string {
  const lines = doc.lines.map(
    (line) => `${line.title} · ${line.qty} × ${line.unitPrice} = ${line.total}`,
  );
  return [
    // Без снимка продавца строка опускается: «Babun CRM» — бренд платформы, а
    // не бизнеса, и в бумаге для клиента ему делать нечего.
    doc.seller.name || null,
    ...doc.seller.lines,
    `${doc.dict.invoiceEyebrow} ${doc.number}`,
    `${doc.dict.issuedOn}: ${doc.issuedOn}`,
    doc.dueOnKnown ? `${doc.dict.dueOn}: ${doc.dueOn}` : null,
    lines.length > 0 ? "" : null,
    ...lines,
    "",
    // Итоги — РОВНО те строки и в том порядке, что печатает бумага: второго
    // решения «что показать» в продукте нет.
    ...doc.totals.map((row) => `${row.label}: ${row.value}`),
    doc.notes ? `\n${doc.notes}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}
