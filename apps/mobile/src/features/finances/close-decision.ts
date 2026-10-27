import { moneySign } from "@babun/shared/common/utils/money";
import type { AccountWithBalance } from "./accounts";

// ЧТО ОТВЕТИТЬ НА «ЗАКРЫТЬ СЧЁТ» — чистой функцией, без экрана.
//
// После «Перевести остаток» экран, решая сам, спросил бы ЗАНОВО со старым остатком —
// «На счёте €50, переведите», хотя деньги уже ушли: решение принимала бы функция того
// рендера, что был до перевода, а новый остаток
// ещё не доехал. Поэтому решение отделено от экрана: оно получает счета, а
// откуда они — из свежего кэша после перечитывания — решает вызывающий.

export type ClosableAccount = Pick<
  AccountWithBalance,
  "id" | "balance" | "has_history" | "is_active" | "brigade_id"
>;

export type CloseDecision =
  /** Операций не было — счёт удаляется насовсем. */
  | { kind: "delete" }
  /** Остаток ноль — закрываем. */
  | { kind: "close" }
  /** Остаток не ноль и его есть куда увести: плюс — ИЗ счёта, минус — В него. */
  | { kind: "transfer"; direction: "out" | "in"; amount: number }
  /** Остаток не ноль, а увести некуда — не вопрос, а объяснение. */
  | { kind: "explain" };

/**
 * ПОСЛЕДНИЙ ОТКРЫТЫЙ СЧЁТ КОМАНДЫ. Закрыв его,
 * команда остаётся без единого счёта: оплату записи и новую операцию этой
 * команды принять будет некуда. Закрыть можно — это обратимо, — но вопрос
 * обязан сказать об этом. Счёт без команды (сирота старой схемы) — не
 * «последний»: у него нет команды, которой он служит.
 */
export function isLastOpenOfTeam<A extends ClosableAccount>(
  account: A,
  accounts: readonly A[],
): boolean {
  if (!account.brigade_id || !account.is_active) return false;
  return !accounts.some(
    (a) => a.id !== account.id && a.is_active && a.brigade_id === account.brigade_id,
  );
}

export function closeDecision<A extends ClosableAccount>(
  account: A,
  accounts: readonly A[],
): CloseDecision {
  if (!account.has_history) return { kind: "delete" };
  const sign = moneySign(account.balance);
  if (sign !== 0) {
    // Куда можно сдать остаток. Команда получателя роли НЕ играет:
    // запрет «между командами только через общий счёт» ушёл
    // вместе с общим счётом. Минус лечится только счётом, где деньги есть.
    const others = accounts.filter((a) => a.is_active && a.id !== account.id);
    if (sign > 0) {
      return others.length > 0
        ? { kind: "transfer", direction: "out", amount: account.balance }
        : { kind: "explain" };
    }
    // МИНУС ЗАКРЫВАЕТСЯ ДЕНЬГАМИ ДРУГИХ СЧЕТОВ — и их должно хватить. Лист
    // перевода берёт самый полный счёт и не переводит больше, чем на нём есть:
    // сумма — не больше его остатка (иначе серая кнопка «недостаточно
    // средств»), и вариант — только если плюсов всех счетов хватает на весь
    // минус (иначе после перевода тот же вопрос по кругу).
    const donors = others.map((a) => a.balance).filter((b) => moneySign(b) > 0);
    const needed = Math.abs(account.balance);
    const cents = (euros: number) => Math.round(euros * 100);
    const available = donors.reduce((sum, b) => sum + cents(b), 0);
    if (available < cents(needed)) return { kind: "explain" };
    return {
      kind: "transfer",
      direction: "in",
      amount: Math.min(needed, Math.max(...donors)),
    };
  }
  // «Основного» счёта нет —
  // передавать при закрытии нечего: первым в оплате становится следующий
  // счёт по порядку сам собой.
  return { kind: "close" };
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
): { account: A; decision: CloseDecision } | null {
  const account = fresh?.find((a) => a.id === before.id);
  if (!fresh || !account || !account.is_active) return null;
  if (moneySign(account.balance - before.balance) === 0) return null;
  return { account, decision: closeDecision(account, fresh) };
}
