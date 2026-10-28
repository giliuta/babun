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

/** Налог кредит-ноты — как его посчитает сервер. Доля налога бумаги от суммы
 *  ноты — в центах (во float «1,005» округлялось не туда), но не больше
 *  остатка налога: прежние ноты уже унесли свою часть. Нота, закрывающая
 *  остаток суммы, несёт весь остаток налога — иначе сумма нот не сходится с
 *  бумагой на цент. `priorVat` — налог прежних нот, положительным числом. */
export function creditNoteVat({
  vat,
  total,
  amount,
  priorVat,
  closes,
}: {
  vat: number;
  total: number;
  amount: number;
  priorVat: number;
  closes: boolean;
}): number {
  const vatCents = Math.round(vat * 100);
  if (!(vatCents > 0)) return 0;
  const left = Math.max(0, vatCents - Math.round(priorVat * 100));
  if (closes) return left / 100;
  const totalCents = Math.round(total * 100);
  if (!(totalCents > 0)) return 0;
  const share = Math.round((vatCents * Math.round(amount * 100)) / totalCents);
  return Math.min(share, left) / 100;
}
