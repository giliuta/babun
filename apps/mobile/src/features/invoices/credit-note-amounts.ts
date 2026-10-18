// СУММЫ КРЕДИТ-НОТЫ — ПО ФОРМУЛЕ СЕРВЕРА. `issue_partial_credit_note`
// возвращает клиенту деньги только сверх нового «к оплате»:
//   вернуть = max(0, получено − (к оплате − сумма ноты)).
// Нота на сумму одного платежа у частично оплаченного инвойса поэтому ничего
// не возвращает — инвойс уменьшается, а деньги остаются у компании.

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Сумма ноты, которая вернёт клиенту ровно `refundable` («Вернуть» платежа
 * инвойса): сам платёж плюс то, что по инвойсу ещё не заплачено, — без этой
 * части сервер гасил бы ею неоплаченный остаток, а не возвращал деньги.
 * Переплата уже лежит сверх «к оплате» и возвращается сервером сама.
 * С КАКОГО платежа уйдут деньги, решает `p_payment_id`; СКОЛЬКО — эта сумма:
 * номер платежа формулу сервера не меняет.
 */
export function creditNoteAmountForRefund(
  refundable: number,
  settlement: { due?: number; paid: number; overpaid: number },
): number {
  // `due` всегда есть у расчёта `calculateInvoiceSettlement`; без него
  // неоплаченного остатка не знаем и считаем его нулём.
  const due = settlement.due ?? settlement.paid;
  const unpaid = due - settlement.paid - settlement.overpaid;
  return round2(Math.min(due, Math.max(0, refundable + unpaid)));
}

/** Сколько останется заплатить после ноты на `value`, когда возврата нет:
 *  новое «к оплате» минус уже полученное. */
export function creditNoteLeftToPay(due: number, paid: number, value: number): number {
  return round2(Math.max(0, due - value - paid));
}
