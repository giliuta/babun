// ОКНО ИСТОРИИ СВЕРОК → «ПОСЛЕДНЯЯ СВЕРКА КАЖДОЙ КАССЫ».
//
// Чистая свёртка вынесена из cash-counts.ts отдельно от запроса: она решает
// денежный вопрос «можно ли утверждать, что кассу не сверяли ни разу», и это
// утверждение обязано быть закреплено тестом (cash-counts-window.test.ts) —
// а модуль с запросом тянет supabase-клиент и в тест не импортируется.

/** Строка сверки. Деньги — как в базе: `expected` может быть отрицательным
 *  (счёт в долге), `counted` — никогда. */
export interface CashCount {
  id: string;
  accountId: string;
  /** День компании, назначенный сервером (не часовым поясом телефона). */
  businessDate: string;
  countedAt: string;
  expected: number;
  counted: number;
  delta: number;
  note: string | null;
  /** Операция «Излишек»/«Недостача». `null` ровно тогда, когда касса сошлась. */
  transactionId: string | null;
}

export interface LastCashCounts {
  /** Последняя сверка каждой кассы. */
  byAccount: Map<string, CashCount>;
  /**
   * Окно запроса закрыло ВСЮ историю сверок тенанта. Только при `true`
   * отсутствие счёта в карте означает «ни разу не сверяли»; при `false` это
   * «не знаем», и подпись обязана промолчать, а не объявить кассу
   * непересчитанной ни разу.
   */
  complete: boolean;
}

/**
 * Сверок мало (одна на кассу в день), строки крошечные — окна с запасом
 * хватает и на год работы команды. Оно нужно не ради экономии трафика, а
 * потому, что запрос без границы однажды вытянет всю историю компании на
 * экран, который открывают двадцать раз в день.
 */
export const COUNT_WINDOW = 500;

/**
 * Свёртка окна запроса. Контракт на входе: строки отсортированы по времени
 * ВНИЗ (первая встреченная и есть последняя сверка этой кассы) и их не больше
 * `COUNT_WINDOW`. Ровно полное окно означает «за краем могла остаться
 * история» — только НЕполное окно даёт право на утверждение «ни разу».
 */
export function foldCashCounts(rows: readonly CashCount[]): LastCashCounts {
  const byAccount = new Map<string, CashCount>();
  for (const row of rows) {
    if (!byAccount.has(row.accountId)) byAccount.set(row.accountId, row);
  }
  return { byAccount, complete: rows.length < COUNT_WINDOW };
}

/**
 * Дата последней сверки для подписи строки (`accountRowCaption`).
 * `undefined` — ответа ещё нет или окно его не покрыло: «ни разу не сверяли»
 * это утверждение о деньгах, и по незнанию его печатать нельзя.
 */
export function lastCountedOn(
  counts: LastCashCounts | undefined,
  accountId: string,
): string | null | undefined {
  if (!counts) return undefined;
  const row = counts.byAccount.get(accountId);
  if (row) return row.businessDate;
  return counts.complete ? null : undefined;
}
