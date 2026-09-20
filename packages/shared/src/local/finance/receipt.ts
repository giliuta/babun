// ЧЕК О ПРИЁМЕ ДЕНЕГ.
//
// Не счёт на оплату (это инвойс) и не фискальный чек (его вправе печатать
// только зарегистрированная касса). Это подтверждение: деньги получены,
// столько-то, от такого-то, тогда-то. Выписывается автоматически на каждый
// приём денег от клиента — по записи и по инвойсу.
//
// Документ НЕИЗМЕНЯЕМ. Откатили оплату — чек не исчезает, а гаснет (`void`):
// номер остаётся занятым, серия без дыр. Дыра в нумерации — первый вопрос
// любой проверки.
//
// С 2026-09-20 выписывается НЕ САМ, а кнопкой (`issue_receipt`), и несёт
// СВОЙ перечень работ (`lines`) — снимком, как и реквизиты сторон.

export type ReceiptStatus = "issued" | "void";

export interface Receipt {
  id: string;
  tenant_id: string;
  /** RC-2026-001 — серия на юрлицо, сквозная по году. */
  number: string;
  year: number;
  seq: number;
  issued_on: string;
  amount: number;
  currency: string;
  /** Снимок налога на момент выдачи. null — операция была без НДС. */
  vat_rate: number | null;
  vat_amount: number | null;
  client_id: string | null;
  appointment_id: string | null;
  invoice_id: string | null;
  transaction_id: string | null;
  account_id: string | null;
  payment_method: string | null;
  status: ReceiptStatus;
  /** Реквизиты сторон НА МОМЕНТ выдачи: переименовали компанию — старый
   *  документ остаётся с прежним названием, как и положено бумаге. */
  seller_snapshot: Record<string, unknown>;
  client_snapshot: Record<string, unknown> | null;
  /** Перечень работ НА МОМЕНТ ВЫДАЧИ. `null` — снимка нет: так выглядят чеки,
   *  выданные до 20.09.2026, и их бумага по-прежнему собирает перечень из
   *  записи или инвойса за спиной проводки. У новых он свой и не меняется,
   *  даже если запись потом поправят. */
  lines: ReceiptLineSnapshot[] | null;
  created_at: string;
}

/** Строка снимка. Поля ровно те, что чистит серверная `_receipt_lines_
 *  snapshot`: чужие ключи до документа не доходят. */
export interface ReceiptLineSnapshot {
  name: string;
  qty: number;
  unit: string | null;
  unitPrice: number;
  sum: number;
}

/** Имя клиента из снимка — карточка могла быть переименована или удалена. */
export function receiptClientName(r: Receipt): string {
  const name = (r.client_snapshot as { name?: string } | null)?.name;
  return name?.trim() || "Клиент";
}
