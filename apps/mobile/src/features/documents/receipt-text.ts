import type { ReceiptDocument } from "./receipt-document";

// ТЕКСТ ЧЕКА ДЛЯ КЛИЕНТА — то, что уходит в WhatsApp или SMS.
//
// СОБИРАЕТСЯ ИЗ ТОЙ ЖЕ МОДЕЛИ, ЧТО PDF И ЭКРАН (`buildReceiptDocument`):
// бумага, картинка и сообщение обязаны говорить одно и то же. Раньше текст
// считал состав сам и после правки 20.09 разошёлся с PDF — писал клиента,
// способ оплаты и дату словом, которых на бумаге уже не было.
//
// Реквизиты и суммы приходят из снимка внутри чека: компанию переименуют,
// запись удалят — выданный документ обязан остаться прежним.
export function buildReceiptShareText(doc: ReceiptDocument): string {
  const lines = doc.lines.map(
    (line) => `${line.name} · ${line.qty} × ${line.unitPrice} = ${line.sum}`,
  );
  return [
    // Без снимка продавца строка опускается: «Babun CRM» — бренд платформы,
    // а не бизнеса, и в бумаге для клиента ему делать нечего (U57).
    doc.seller.name || null,
    ...doc.seller.lines,
    `Чек ${doc.number}`,
    doc.issuedOn,
    lines.length > 0 ? "" : null,
    ...lines,
    "",
    doc.linesTotal ? `Итого работ: ${doc.linesTotal}` : null,
    doc.discount ? `${doc.discount.label}: ${doc.discount.value}` : null,
    doc.vat ? `${doc.vat.label}: ${doc.vat.value}` : null,
    `Получено: ${doc.amount}`,
    // Погашенного чека здесь не бывает: лист не даёт его выслать. Возврат
    // подтверждается своим документом (credit note), а не бумагой о приёме
    // денег, которых у нас уже нет.
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}
