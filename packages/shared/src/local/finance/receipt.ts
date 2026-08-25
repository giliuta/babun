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
  created_at: string;
}

/** Имя клиента из снимка — карточка могла быть переименована или удалена. */
export function receiptClientName(r: Receipt): string {
  const name = (r.client_snapshot as { name?: string } | null)?.name;
  return name?.trim() || "Клиент";
}
