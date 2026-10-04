// One row in the `finance_transactions` ledger. Lives in Supabase;
// `sync_appointment_finance` writes auto-rows on appointment completion,
// /finances UI writes manual rows + transfers + refunds.

export type TransactionType = "income" | "expense" | "transfer" | "refund";
export type TransactionSource = "auto" | "manual";
export type PaymentMethod = "cash" | "card" | "transfer" | "other";
export type AppointmentPaymentKind = "prepayment" | "settlement";

/** Порядок способов оплаты во всех списках и чипах: от самого частого. */
export const PAYMENT_METHODS: readonly PaymentMethod[] = [
  "cash",
  "card",
  "transfer",
  "other",
];

/**
 * Слова глоссария: одно слово на одну сущность во всём продукте.
 *
 * `transfer` — «Банк», а не «Перевод»: перевод между своими счетами это
 * ТИП ОПЕРАЦИИ, и одно слово на две разные вещи путало даже нас (в одном
 * экране «Нал», в другом «Наличные», в третьем «Иное»).
 */
export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Наличные",
  card: "Карта",
  transfer: "Банк",
  other: "Другое",
};

export const TX_TYPE_LABEL: Record<TransactionType, string> = {
  income: "Доход",
  expense: "Расход",
  transfer: "Перевод",
  refund: "Возврат",
};

/** То же слово для мест, где способ приходит из БД просто строкой (леджер
 *  инвойса). Незнакомое значение печатается как есть — выдумывать способ,
 *  которым приняли деньги, нельзя. */
export function paymentMethodLabel(method: string | null | undefined): string {
  if (!method) return "";
  return PAYMENT_METHOD_LABEL[method as PaymentMethod] ?? method;
}

export type ReversalKind = "not_received" | "client_refund";

export interface FinanceTransaction {
  id: string;
  tenant_id: string;
  type: TransactionType;
  amount: number; // positive for income, positive for expense (sign is implied by type), negative for refund (stored as-is from trigger)
  currency: string;
  category_id: string | null;
  account_id: string | null;
  appointment_id: string | null;
  appointment_payment_kind: AppointmentPaymentKind | null;
  client_id: string | null;
  team_id: string | null; // brigade
  master_id: string | null;
  payment_method: PaymentMethod | null;
  notes: string | null;
  /** Ставка НДС, действовавшая В МОМЕНТ проводки. NULL — операция без НДС
   *  (компания без налога или строка создана до его включения). Снимок, а не
   *  ссылка на настройку: подняли ставку — прошлое не переписывается. */
  /** Как оператор назначил налог: три клавиши в листе операции.
   *  null — унаследовано от настроек (автопроводки и старые строки). */
  vat_mode: "none" | "inclusive" | "exclusive" | null;
  vat_rate: number | null;
  /** Налог ВНУТРИ суммы операции: в кассу пришло 480, здесь 80. Знак
   *  повторяет знак суммы — возврат уносит и налог. */
  vat_amount: number | null;
  occurred_on: string; // YYYY-MM-DD — drives day grouping
  /** HH:MM по часам бизнеса — когда операция случилась в этот день. null —
   *  без времени (старые строки, авто-проводки: у них время берётся у записи). */
  occurred_time: string | null;
  receipt_url: string | null; // storage path in `receipts` bucket
  transfer_group_id: string | null;
  invoice_id: string | null;
  /** Долг, который гасит эта операция. Платёж по долгу — обычная строка
   *  журнала: сам долг деньгами не является и в прибыль не входит. */
  debt_id: string | null;
  refund_of_id: string | null;
  /** ПОЧЕМУ МИНУС. Оба случая лежат в леджере типом `refund`, но означают
   *  разное: `not_received` — оплату сняли, деньги так и не пришли (работа
   *  уходит в долг); `client_refund` — деньги вернули клиенту. Разными
   *  словами их называет UI, поэтому поле доезжает до клиента. */
  reversal_kind: ReversalKind | null;
  source: TransactionSource;
  /** Внесена кнопкой «Финансы дня» календаря (владелец 04.10: «с дохода и
   *  расхода календаря переносится в финансы, а с финансов обратно — нет»).
   *  День календаря считает деньги записей и такие операции; возврат
   *  наследует признак своего дохода. Нет поля — не из календаря. */
  from_calendar?: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

/**
 * Sign-aware impact on a balance. Refund is stored as negative income
 * from the trigger; for manual refunds we expect amount > 0 and use
 * the type field. Either way this returns the signed amount you'd
 * add to a running balance.
 */
export function signedAmount(t: FinanceTransaction): number {
  if (t.type === "income") return t.amount;
  if (t.type === "refund") return -Math.abs(t.amount);
  if (t.type === "expense") return -t.amount;
  // transfer: the pair sums to zero across tenant; each leg is signed
  // already (negative on source, positive on destination).
  return t.amount;
}

export function isExpense(t: FinanceTransaction): boolean {
  return t.type === "expense";
}

/**
 * Можно ли править операцию прямо в её форме.
 *
 * Нельзя двоим: проводке, рождённой записью (`source === "auto"`) — она
 * меняется в самой записи, иначе деньги разъедутся с работой; и операции,
 * привязанной к инвойсу — её меняет документ. Всё остальное человек правит
 * там же, где видит. (Третьей была коррекция пересчёта кассы — пересчёт
 * удалён 30.09 по слову владельца, миграция 20260930235900.)
 */
export function canEditTransaction(tx: FinanceTransaction): boolean {
  return (
    tx.source !== "auto" &&
    !tx.invoice_id &&
    (tx.type === "income" || tx.type === "expense")
  );
}
