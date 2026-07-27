// Помесячная разбивка счёта «сколько зашло с каждой команды» — носитель
// требования №4 (общий счёт компании отслеживает приток по командам).
//
// Три честных разреза дельты счёта за период:
//   direct       — прямые оплаты: income − |refund| по tx.team_id × способу
//                  (возврат неттится в команду исходника — refund по
//                  инварианту БД копирует team_id оригинала; сирота с
//                  team_id NULL → строка «Компания»);
//   collections  — «инкассации»: transfer-ноги «плюс» на этот счёт,
//                  атрибуция по КОМАНДЕ СЧЁТА-ИСТОЧНИКА через
//                  transfer_group_id (нужны обе ноги — кормить полным
//                  месячным срезом транзакций, не только этого счёта);
//   transfersNet — сальдо исходящих transfer-ног (отток с этого счёта).
// Плюс expensesNet (расходы со счёта; в блоке «Поступления» не рисуется,
// но без него не сойдётся инвариант) и total = вся дельта счёта за период.
//
// Инвариант (закреплён тестом): directTotal + collectionsTotal +
// transfersNet + expensesNet === total.

import type {
  FinanceTransaction,
  PaymentMethod,
} from "@babun/shared/local/finance/transaction";
import { signedAmount } from "@babun/shared/local/finance/transaction";

export interface TeamDirectInflow {
  /** null — строка «Компания» (операция без команды). */
  teamId: string | null;
  /** income − |refund| по способам; только ненулевые ключи. */
  byMethod: Partial<Record<PaymentMethod, number>>;
  total: number;
}

export interface TeamCollection {
  /** Команда счёта-источника; null — перевод со счёта компании. */
  teamId: string | null;
  amount: number;
}

export interface AccountInflowBreakdown {
  direct: TeamDirectInflow[];
  collections: TeamCollection[];
  /** Сальдо исходящих переводов (≤ 0). */
  transfersNet: number;
  /** Σ расходов со счёта (≤ 0); в блоке поступлений не отображается. */
  expensesNet: number;
  /** Полная дельта счёта за период — футер «За месяц». */
  total: number;
}

/** Счёт в объёме, нужном для атрибуции ноги-источника. */
export interface InflowAccountRef {
  id: string;
  brigade_id: string | null;
}

export function breakdownAccountInflowByTeam(
  accountId: string,
  /** ПОЛНЫЙ срез транзакций периода (все счета — нужны обе ноги пары). */
  transactions: readonly FinanceTransaction[],
  accounts: readonly InflowAccountRef[],
): AccountInflowBreakdown {
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const directByTeam = new Map<string | null, TeamDirectInflow>();
  const collectionsByTeam = new Map<string | null, number>();
  let transfersNet = 0;
  let expensesNet = 0;
  let total = 0;

  const bumpDirect = (
    teamId: string | null,
    method: PaymentMethod | null,
    delta: number,
  ) => {
    const row =
      directByTeam.get(teamId) ??
      ({ teamId, byMethod: {}, total: 0 } satisfies TeamDirectInflow);
    const key = method ?? "other";
    const next = (row.byMethod[key] ?? 0) + delta;
    if (next === 0) delete row.byMethod[key];
    else row.byMethod[key] = next;
    row.total += delta;
    directByTeam.set(teamId, row);
  };

  for (const tx of transactions) {
    if (tx.account_id !== accountId) continue;
    const delta = signedAmount(tx);
    total += delta;

    if (tx.type === "income") {
      bumpDirect(tx.team_id, tx.payment_method, delta);
    } else if (tx.type === "refund") {
      // Возврат по инварианту БД идёт по счёту и команде исходника —
      // неттим его в ту же команду, откуда пришёл доход.
      bumpDirect(tx.team_id, tx.payment_method, delta);
    } else if (tx.type === "expense") {
      expensesNet += delta;
    } else if (tx.type === "transfer") {
      if (tx.amount > 0) {
        // Инкассация: атрибуция по команде счёта-источника (вторая нога).
        const sourceLeg = tx.transfer_group_id
          ? transactions.find(
              (candidate) =>
                candidate.transfer_group_id === tx.transfer_group_id &&
                candidate.type === "transfer" &&
                candidate.id !== tx.id,
            )
          : undefined;
        const sourceAccount = sourceLeg?.account_id
          ? accountById.get(sourceLeg.account_id)
          : undefined;
        const teamId = sourceAccount?.brigade_id ?? null;
        collectionsByTeam.set(
          teamId,
          (collectionsByTeam.get(teamId) ?? 0) + tx.amount,
        );
      } else {
        transfersNet += tx.amount;
      }
    }
  }

  const direct = [...directByTeam.values()].sort((a, b) => b.total - a.total);
  const collections = [...collectionsByTeam.entries()]
    .map(([teamId, amount]) => ({ teamId, amount }))
    .sort((a, b) => b.amount - a.amount);

  return { direct, collections, transfersNet, expensesNet, total };
}
