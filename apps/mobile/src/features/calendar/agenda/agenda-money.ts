import { formatEUR } from "@babun/shared/common/utils/money";

// ДЕНЬГИ СТРОКИ «СПИСКА» — ОДНИМ СЛОВОМ НА ОДИН СМЫСЛ.
//
// Долг говорится один раз — справа, «Долг €60». Повторять его суммой,
// словом «Не оплачена» и ситуацией «Долг» слева значит сказать одно трижды.
// Ничего не оплачено — эта строка и есть сумма; оплачена часть — сумма
// визита остаётся сверху, долг под ней.
//
// Долг — только после визита: пока визит впереди, неоплаченное — «к оплате»
// серым. Отменённая — сумма без «к оплате»: денег по ней никто не ждёт.

interface AgendaMoney {
  /** Верхняя строка: сумма визита или, когда не оплачено ничего, долг. */
  amount: string;
  amountWarn: boolean;
  /** Строка под суммой: долг части или «к оплате». */
  note: string | null;
  noteWarn: boolean;
  /** Долг уже сказан справа — слева его не повторять. */
  debtSaid: boolean;
}

export function agendaMoney(input: {
  total: number;
  debt: number;
  cancelled: boolean;
  /** Визит выполнен или его время прошло. */
  afterVisit: boolean;
}): AgendaMoney | null {
  const { total, debt, cancelled, afterVisit } = input;
  if (!(total > 0)) return null;
  const plain: AgendaMoney = {
    amount: formatEUR(total),
    amountWarn: false,
    note: null,
    noteWarn: false,
    debtSaid: false,
  };
  if (cancelled || !(debt > 0)) return plain;
  if (!afterVisit) return { ...plain, note: `${formatEUR(debt)} к оплате` };
  const said = `Долг ${formatEUR(debt)}`;
  if (debt >= total) return { ...plain, amount: said, amountWarn: true, debtSaid: true };
  return { ...plain, note: said, noteWarn: true, debtSaid: true };
}

/** Слово слева от имени — статус записи. О деньгах оно говорит только то,
 *  чего справа не сказано: у записи без суммы долга нет и слова о деньгах
 *  нет; долг суммой справа или ситуацией «Долг» уже назван — «Не оплачена»
 *  его не повторяет (при скрытых суммах выходило «Не оплачена · Долг»).
 *  Незакрытый визит здесь не словом, а своим правилом даты. */
export function agendaStatusWord(input: {
  cancelled: boolean;
  /** Время прошло, статус остался «запланирована». */
  overdue: boolean;
  debt: number;
  debtSaid: boolean;
  situationSaysDebt: boolean;
}): string | null {
  if (input.cancelled) return "Отменена";
  if (!input.overdue || !(input.debt > 0)) return null;
  if (input.debtSaid || input.situationSaysDebt) return null;
  return "Не оплачена";
}
