// Account rows with balances, the shared cache reset and the no-pause rule
// every money write carries.

import type { QueryClient } from "@tanstack/react-query";
import type { AccountBalanceRow } from "@babun/shared/db/repositories/finance-transactions";
import type { Account } from "@babun/shared/local/finance/account";

export type AccountWithBalance = Account & {
  /** opening_balance + серверная дельта журнала. */
  balance: number;
  /** Была ли по счёту хоть одна операция. */
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

// НИ ОДНА ЗАПИСЬ НЕ ВСТАЁТ В ПАУЗУ (ТЗ §8). По умолчанию react-query держит
// мутацию без сети в `paused`: `mutateAsync` не резолвится, кнопка крутится
// вечно, ошибки нет, а свёрнутое приложение уносит намерение молча — человек
// так и не узнаёт, что стало с деньгами. Финансы онлайн-only на запись,
// поэтому запрос обязан честно упасть сетевой ошибкой: экран называет причину
// и сохраняет набранное, а повтор попадает в серверный дедуп по `request_id`.
//
// Стоит на КАЖДОЙ денежной записи продукта, а не только на переводе: закрытие
// счёта, перестановка строк и сохранение операции без сети зависали ровно так
// же.
export const NEVER_PAUSE = { networkMode: "always" } as const;

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
      balance: a.opening_balance + (b?.delta ?? 0),
      has_history: b?.has_history ?? false,
      last_outflow_on: b?.last_outflow_on ?? null,
      last_tx_on: b?.last_tx_on ?? null,
      first_tx_on: b?.first_tx_on ?? null,
    };
  });
}
