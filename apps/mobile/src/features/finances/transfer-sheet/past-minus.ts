import type { AccountMinus } from "../account-alerts";

// ПЕРЕВОД ЗАДНИМ ЧИСЛОМ — ТЕ ЖЕ СЛОВА О МИНУСЕ, ЧТО У РАСХОДА. Минус на счёте
// разрешён, и сервер сверяет перевод только с остатком на сегодня. Перевод,
// датированный прошлым днём, убавляет источник с того дня по сегодня — и в
// выписке за те дни остаток мог стать отрицательным, хотя сегодня денег
// хватает. Запрета нет; лист называет это до «Перевести».

/** Движение счёта так, как его считает `account_balances`. */
export interface AccountMove {
  occurred_on: string;
  type: string;
  amount: number;
}

const moveCents = (move: AccountMove): number => {
  const cents = Math.round(Number(move.amount) * 100);
  if (move.type === "expense") return -cents;
  if (move.type === "refund") return -Math.abs(cents);
  return cents;
};

/**
 * Самый низкий остаток источника на конец дня — с дня перевода по сегодня — уже
 * после перевода. Ниже нуля — кто и сколько; иначе `null`. Перевод сегодняшним
 * днём сверяет обычная проверка листа, здесь молчим.
 */
export function pastTransferMinus({
  name,
  balance,
  date,
  today,
  movesAfter,
  amount,
}: {
  name: string;
  /** Остаток источника сейчас. */
  balance: number;
  date: string;
  today: string;
  /** Движения источника ПОЗЖЕ дня перевода. */
  movesAfter: readonly AccountMove[];
  amount: number;
}): AccountMinus | null {
  if (date >= today || !(amount > 0)) return null;
  const byDay = new Map<string, number>();
  let later = 0;
  for (const move of movesAfter) {
    if (move.occurred_on <= date) continue;
    const cents = moveCents(move);
    later += cents;
    byDay.set(move.occurred_on, (byDay.get(move.occurred_on) ?? 0) + cents);
  }
  let running = Math.round(balance * 100) - later;
  let lowest = running;
  for (const day of [...byDay.keys()].sort()) {
    running += byDay.get(day) ?? 0;
    lowest = Math.min(lowest, running);
  }
  const after = lowest - Math.round(amount * 100);
  return after < 0 ? { name, after: after / 100 } : null;
}
