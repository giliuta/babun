// ДОЛГ — СОБСТВЕННАЯ СУЩНОСТЬ С НАПРАВЛЕНИЕМ (STORY-080).
//
// До этого долг был не строкой, а вычислением по записи: работа сделана,
// деньги не пришли. Значит рождаться он умел только из визита, и оба случая
// владельца записать было негде — «Вася должен мне €100» без визита и «я
// должен Gree €900» за товар, взятый до оплаты.
//
// Одна сущность на оба направления: у «мне должны» и «я должен» одна форма и
// одна арифметика, разное только направление и слово.
//
// ДОЛГ НЕ ДЕНЬГИ. Он не входит в прибыль ни в момент появления, ни после;
// в прибыль входит ПЛАТЁЖ по нему — обычная операция с `debt_id`. Здесь
// поэтому нет ни знака, ни счёта: сумма долга всегда положительная, а куда
// поедут деньги, решает направление.

export type DebtDirection = "incoming" | "outgoing";

export interface Debt {
  id: string;
  tenant_id: string;
  /** «incoming» — должны НАМ, «outgoing» — должны МЫ. */
  direction: DebtDirection;
  /** Клиент из справочника, если долг за ним. Поставщика в справочнике нет. */
  client_id: string | null;
  /** Имя хранится ВСЕГДА, даже когда есть client_id: клиента могут удалить,
   *  а долг остаётся, и строка обязана продолжать называть человека. */
  counterparty: string;
  amount: number;
  currency: string;
  category_id: string | null;
  note: string | null;
  /** Документ под долгом — путь в том же приватном бакете, что у операции:
   *  накладная поставщика, расписка, счёт. */
  receipt_url: string | null;
  occurred_on: string;
  /** Час по часам компании, «HH:MM». NULL — час неизвестен: у долгов,
   *  заведённых до появления колонки, его нет, и выдумывать нельзя. */
  occurred_time: string | null;
  team_id: string | null;
  created_at: string;
}

/** Слово владельца: «две ступени — я должен или мне должны» (2026-09-10). */
export const DEBT_DIRECTION_LABEL: Record<DebtDirection, string> = {
  incoming: "Мне должны",
  outgoing: "Я должен",
};

/** Направления в порядке показа: сначала деньги, которые придут. */
export const DEBT_DIRECTIONS: readonly DebtDirection[] = ["incoming", "outgoing"];

/**
 * Платёж по долгу приходит доходом, когда должны нам, и расходом, когда
 * должны мы. Одна функция на продукт: форма платежа и подсчёт остатка
 * обязаны согласиться, иначе оплата долга уедет не в ту сторону прибыли.
 */
export function debtPaymentType(direction: DebtDirection): "income" | "expense" {
  return direction === "incoming" ? "income" : "expense";
}

/**
 * Остаток в центах: сумма минус уже уплаченное. Считаем В ЦЕНТАХ, потому что
 * 900 − 3 × 300 в плавающей точке даёт не ноль, и закрытый долг вечно висел
 * бы в списке на копейку.
 *
 * Знак сохраняем: отрицательный остаток — заплатили больше, чем должны, и это
 * человеку надо показать, а не проглотить (та же поправка, что «Переплата» у
 * записи).
 */
export function debtRemainderCents(amount: number, paid: number): number {
  const total = Number.isFinite(amount) ? Math.round(amount * 100) : 0;
  const covered = Number.isFinite(paid) ? Math.round(paid * 100) : 0;
  return total - covered;
}

/** Долг закрыт, когда платить больше нечего. Статуса в базе нет нарочно:
 *  колонка разъезжается с деньгами на первой же правке платежа. */
export function debtIsSettled(amount: number, paid: number): boolean {
  return debtRemainderCents(amount, paid) <= 0;
}

/** Σ платежей по каждому долгу: `debt_id` → сумма. Знак не важен — расход
 *  по «я должен» лежит в базе положительным, как и доход. */
export function debtPaidTotals(
  transactions: readonly { debt_id?: string | null; amount: number }[],
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const tx of transactions) {
    if (!tx.debt_id) continue;
    const amount = Number(tx.amount ?? 0);
    if (!Number.isFinite(amount)) continue;
    totals.set(tx.debt_id, (totals.get(tx.debt_id) ?? 0) + Math.abs(amount));
  }
  return totals;
}
