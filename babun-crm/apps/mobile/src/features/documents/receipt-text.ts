import { money } from "@babun/shared/common/utils/money";
import { paymentMethodLabel } from "@babun/shared/local/finance/transaction";
import type { Receipt } from "@babun/shared/local/finance/receipt";
import { formatInvoiceDate } from "@/features/invoices/format";

// ТЕКСТ ЧЕКА ДЛЯ КЛИЕНТА — то, что уходит в WhatsApp или SMS.
//
// Читают его на чужом телефоне, без нашего приложения, поэтому бумага должна
// называть себя целиком: кто, кому, сколько, когда и за что. Порядок и правила
// те же, что у инвойса (`buildInvoiceShareText`), — иначе два документа одной
// компании выглядели бы выпущенными разными продуктами.
//
// Реквизиты берутся ТОЛЬКО из снимка внутри чека. Компанию потом переименуют,
// клиента удалят — выданный документ обязан остаться прежним.
export function buildReceiptShareText({
  receipt,
  clientName,
}: {
  receipt: Receipt;
  /** Имя получателя из снимка — уже посчитано вызывающим (`receiptClientName`). */
  clientName: string;
}): string {
  const seller = receipt.seller_snapshot as {
    name?: string;
    address?: string;
  } | null;
  return [
    // Без снимка продавца строка опускается: «Babun CRM» — бренд платформы,
    // а не бизнеса, и в бумаге для клиента ему делать нечего (U57).
    seller?.name?.trim() || null,
    seller?.address?.trim() || null,
    `Чек ${receipt.number}`,
    `Клиент: ${clientName}`,
    `Дата: ${formatInvoiceDate(receipt.issued_on)}`,
    receipt.payment_method
      ? `Оплата: ${paymentMethodLabel(receipt.payment_method)}`
      : null,
    "",
    `Получено: ${money(receipt.amount, receipt.currency)}`,
    receipt.vat_amount
      ? `в т.ч. НДС${receipt.vat_rate ? ` ${receipt.vat_rate}%` : ""}: ${money(receipt.vat_amount, receipt.currency)}`
      : null,
    // Погашенного чека здесь не бывает: лист не даёт его выслать. Возврат
    // подтверждается своим документом (credit note), а не бумагой о приёме
    // денег, которых у нас уже нет.
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}
