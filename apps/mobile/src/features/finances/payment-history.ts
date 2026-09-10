import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";

// ИСТОРИЯ ПЛАТЕЖЕЙ ЖИВЁТ В ЗАПИСИ, А НЕ В ЛЕНТЕ КОМПАНИИ (владелец
// 2026-09-09: «эту историю запихнуть в дополнение к записи… кнопочку сделать,
// открывается — и там видно, как провёл платёж»).
//
// Причина: один визит 6 сентября держал в главной ленте 19 строк — оплату
// вносили и снимали восемь раз, пока подбирали сумму. На главной это шум («оно
// забьёт всё»), а внутри записи — ровно то, что человек хочет знать про
// ЭТОГО клиента: сколько раз платили, чем и что снимали.
//
// Ничего не удаляем: строки остаются в журнале, меняется только место показа.

export type PaymentEventTone = "in" | "out";

export interface PaymentEvent {
  id: string;
  /** Что это было, словами: «Оплата», «Предоплата», «Оплата снята», «Возврат». */
  title: string;
  /** Сумма без знака — знак и цвет рисует строка по `tone`. */
  amount: number;
  tone: PaymentEventTone;
  /** Снятое и возвращённое печатается тише живых денег. */
  cancelled: boolean;
  accountId: string | null;
  at: string;
}

/** Слово события. Тип говорит направление, `reversal_kind` — причину минуса,
 *  `appointment_payment_kind` — предоплата это или расчёт. Путать «снята» и
 *  «возврат» нельзя: в первом случае денег не было, во втором их вернули. */
export function paymentEventTitle(
  tx: Pick<
    FinanceTransaction,
    "type" | "reversal_kind" | "appointment_payment_kind"
  >,
): string {
  if (tx.type === "refund") {
    return tx.reversal_kind === "client_refund" ? "Возврат" : "Оплата снята";
  }
  return tx.appointment_payment_kind === "prepayment" ? "Предоплата" : "Оплата";
}

/** Журнал записи в порядке событий: раньше — выше, как в разговоре. */
export function paymentEvents(
  transactions: readonly FinanceTransaction[],
): PaymentEvent[] {
  return [...transactions]
    .filter((tx) => tx.type === "income" || tx.type === "refund")
    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
    .map((tx) => ({
      id: tx.id,
      title: paymentEventTitle(tx),
      amount: Math.abs(tx.amount),
      tone: tx.type === "refund" ? "out" : "in",
      cancelled: tx.type === "refund",
      accountId: tx.account_id,
      at: tx.created_at,
    }));
}

/** Сколько денег осталось по записи после всех снятий — то же число, что
 *  стоит в самой записи как оплаченное. Считаем здесь, чтобы лист сходился с
 *  блоком оплаты знак в знак. */
export function paymentEventsNet(events: readonly PaymentEvent[]): number {
  const cents = events.reduce(
    (sum, e) => sum + Math.round(e.amount * 100) * (e.tone === "out" ? -1 : 1),
    0,
  );
  return cents / 100;
}
