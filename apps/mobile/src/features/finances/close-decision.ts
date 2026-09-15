import { moneySign } from "@babun/shared/common/utils/money";
import type { AccountWithBalance } from "./accounts";

// ЧТО ОТВЕТИТЬ НА «ЗАКРЫТЬ СЧЁТ» — чистой функцией, без экрана.
//
// Разбор багов счетов 2026-09-15: после «Перевести остаток» экран спрашивал
// ЗАНОВО со старым остатком — «На счёте €50, переведите», хотя деньги уже ушли.
// Решение принимала функция того рендера, что был до перевода, а новый остаток
// ещё не доехал. Поэтому решение отделено от экрана: оно получает счета, а
// откуда они — из свежего кэша после перечитывания — решает вызывающий.

export type ClosableAccount = Pick<
  AccountWithBalance,
  "id" | "balance" | "has_history" | "is_active" | "is_primary" | "brigade_id"
>;

export type CloseDecision<A extends ClosableAccount> =
  /** Операций не было — счёт удаляется насовсем. */
  | { kind: "delete" }
  /** Остаток ноль — закрываем; `successor` получит флаг «основной». */
  | { kind: "close"; successor: A | null }
  /** Остаток не ноль и его есть куда увести: плюс — ИЗ счёта, минус — В него. */
  | { kind: "transfer"; direction: "out" | "in"; amount: number }
  /** Остаток не ноль, а увести некуда — не вопрос, а объяснение. */
  | { kind: "explain" };

export function closeDecision<A extends ClosableAccount>(
  account: A,
  accounts: readonly A[],
): CloseDecision<A> {
  if (!account.has_history) return { kind: "delete" };
  const sign = moneySign(account.balance);
  if (sign !== 0) {
    // Куда можно сдать остаток. Команда получателя роли НЕ играет (владелец
    // 2026-08-15): запрет «между командами только через общий счёт» ушёл
    // вместе с общим счётом. Минус лечится только счётом, где деньги есть.
    const others = accounts.filter((a) => a.is_active && a.id !== account.id);
    const canTransfer =
      sign < 0 ? others.some((a) => moneySign(a.balance) > 0) : others.length > 0;
    return canTransfer
      ? {
          kind: "transfer",
          direction: sign < 0 ? "in" : "out",
          amount: Math.abs(account.balance),
        }
      : { kind: "explain" };
  }
  // КОМУ ПЕРЕЙДЁТ «ОСНОВНОЙ», ЕСЛИ ЗАКРЫВАЕМ ИМЕННО ЕГО: следующий живой счёт
  // той же команды в её же порядке. Некому — `null`, и команда осталась без
  // основного осознанно, а не молча.
  const successor =
    account.is_primary && account.brigade_id
      ? (accounts.find(
          (a) =>
            a.is_active &&
            a.id !== account.id &&
            a.brigade_id === account.brigade_id,
        ) ?? null)
      : null;
  return { kind: "close", successor };
}

/**
 * Вопрос ПОСЛЕ перевода, затеянного ради закрытия. `before` — счёт в момент
 * вопроса, `fresh` — счета, перечитанные после перевода.
 *
 * `null` — спрашивать не о чем: свежих данных нет, счёта уже нет или он закрыт,
 * либо остаток не сдвинулся — лист закрыли, ничего не переведя, и повторять тот
 * же вопрос значило бы гонять человека по кругу.
 */
export function closeDecisionAfterTransfer<A extends ClosableAccount>(
  before: ClosableAccount,
  fresh: readonly A[] | undefined,
): { account: A; decision: CloseDecision<A> } | null {
  const account = fresh?.find((a) => a.id === before.id);
  if (!fresh || !account || !account.is_active) return null;
  if (moneySign(account.balance - before.balance) === 0) return null;
  return { account, decision: closeDecision(account, fresh) };
}
