// Account rows with balances, the shared cache reset and the no-pause rule
// every money write carries.

import type { QueryClient } from "@tanstack/react-query";
import type { AccountBalanceRow } from "@babun/shared/db/repositories/finance-transactions";
import type { Account } from "@babun/shared/local/finance/account";

export type AccountWithBalance = Account & {
  /** opening_balance + серверная дельта журнала. Пока `balance_known` нет —
   *  заглушка, в суммы и решения не идёт. */
  balance: number;
  /** Сервер назвал остаток этого счёта. Не назвал — у человека нет права
   *  «Счета» на деньги этой команды (`account_balances` отдаёт ему только
   *  видимые счета): остаток неизвестен, а не «€0». */
  balance_known: boolean;
  /** Была ли по счёту хоть одна операция. Историю не знаем — считается, что
   *  была: «истории нет» разрешило бы сменить вид счёта и удалить его. */
  has_history: boolean;
  /** Даты для подписей строки счёта (YYYY-MM-DD, null — движений не было). */
  last_outflow_on: string | null;
  last_tx_on: string | null;
  first_tx_on: string | null;
};

// Любая правка счёта задевает ДВА кэша. Второй — ["payment-accounts"]: набор
// касс для приёма денег, он живёт 5 минут и своей инвалидации не имел, поэтому
// закрытый счёт ещё пять минут предлагался в записи, инвойсе и шаблоне.
export function invalidateAccounts(qc: QueryClient): void {
  qc.invalidateQueries({ queryKey: ["accounts"] });
  qc.invalidateQueries({ queryKey: ["payment-accounts"] });
}

// Правило «ни одна запись не встаёт в паузу» — `lib/never-pause.ts`.
export { NEVER_PAUSE } from "@/lib/never-pause";

/** Строки счетов + серверные остатки → счета с живым остатком. Одна склейка на
 *  хук и на чтение из кэша после перевода (закрытие счёта). */
export function mergeAccountBalances(
  rows: readonly Account[],
  balances: readonly AccountBalanceRow[],
): AccountWithBalance[] {
  const byAccount = new Map(
    balances.filter((b) => b.account_id).map((b) => [b.account_id, b]),
  );
  return rows.map((a): AccountWithBalance => {
    const b = byAccount.get(a.id);
    return {
      ...a,
      balance: b ? a.opening_balance + b.delta : 0,
      balance_known: !!b,
      has_history: b ? b.has_history : true,
      last_outflow_on: b?.last_outflow_on ?? null,
      last_tx_on: b?.last_tx_on ?? null,
      first_tx_on: b?.first_tx_on ?? null,
    };
  });
}

/** Прочерк на месте остатка, которого человеку не показывают. */
export const UNKNOWN_BALANCE_TEXT = "—";

/** Остаток словами: число, пока его назвал сервер, иначе прочерк. «€0» вместо
 *  неизвестного остатка был бы враньём про деньги. */
export function balanceText(
  account: Pick<AccountWithBalance, "balance" | "balance_known">,
  format: (amount: number) => string,
): string {
  return account.balance_known ? format(account.balance) : UNKNOWN_BALANCE_TEXT;
}
