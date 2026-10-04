// ФАКТЫ СТРАНИЦЫ ПАРТНЁРА — БЕЗ REACT (владелец 04.10, мозговой штурм
// страницы партнёра: «да, давай делай»). Был ли он в приложении, сколько
// денег прошло через его команды за месяц и сколько ему выплачено. Счёт
// проверяется тестом.

const MONTHS_SHORT = [
  "янв", "фев", "мар", "апр", "мая", "июн",
  "июл", "авг", "сен", "окт", "ноя", "дек",
];

const MONTHS_PREP = [
  "январе", "феврале", "марте", "апреле", "мае", "июне",
  "июле", "августе", "сентябре", "октябре", "ноябре", "декабре",
];

const pad = (n: number) => String(n).padStart(2, "0");
const ymdOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** «€15 в октябре»; не было — «в октябре нет». Деньги форматирует зовущий. */
export function monthSumLine(sum: number, money: string, now: Date): string {
  const month = MONTHS_PREP[now.getMonth()];
  if (sum <= 0) return `в ${month} нет`;
  return `${money} в ${month}`;
}

/** КОГДА БЫЛ В ПРИЛОЖЕНИИ — «сегодня, 13:40», «вчера, 09:12», «2 окт».
 *  `null` — входа ещё не было (аккаунт есть, а в приложение не входили). Время —
 *  телефона: «сегодня» — по часам того, кто смотрит. */
export function seenLine(lastSeenAt: string | null, now: Date): string {
  if (!lastSeenAt) return "входа не было";
  const seen = new Date(lastSeenAt);
  if (Number.isNaN(seen.getTime())) return "входа не было";
  const time = `${pad(seen.getHours())}:${pad(seen.getMinutes())}`;
  const today = ymdOf(now);
  const yesterday = ymdOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const day = ymdOf(seen);
  if (day >= today) return `сегодня, ${time}`;
  if (day === yesterday) return `вчера, ${time}`;
  const base = `${seen.getDate()} ${MONTHS_SHORT[seen.getMonth()]}`;
  return seen.getFullYear() === now.getFullYear() ? base : `${base} ’${String(seen.getFullYear()).slice(2)}`;
}

export interface MoneyRow {
  date: string;
  team_id: string | null;
  status?: string | null;
  kind?: string | null;
}

/** ДЕНЬГИ ЕГО КОМАНД. «Получено» — за текущий месяц по записям месяца;
 *  «Долги» — по всем прошедшим и сегодняшним записям, сколько бы им ни было:
 *  долг не сгорает с концом месяца. События и отменённые — не работа.
 *  Сколько получено и сколько должны — решает общее правило записи
 *  (`getPaidAmount` / `getDebtAmount`), его передаёт зовущий. */
export function teamMoneyOf<R extends MoneyRow>(
  rows: readonly R[],
  teamIds: readonly string[],
  now: Date,
  paid: (row: R) => number,
  debt: (row: R) => number,
): { received: number; debt: number } {
  const teams = new Set(teamIds);
  const ym = ymdOf(now).slice(0, 7);
  const today = ymdOf(now);
  let received = 0;
  let owed = 0;
  for (const row of rows) {
    if (row.kind === "event" || row.status === "cancelled") continue;
    if (!row.team_id || !teams.has(row.team_id)) continue;
    if (row.date.startsWith(ym)) received += Math.max(0, paid(row));
    if (row.date <= today) owed += Math.max(0, debt(row));
  }
  return { received: cents(received), debt: cents(owed) };
}

export interface PayoutLike {
  type: string;
  amount: number | string;
  occurred_on: string | null;
  created_at: string;
}

/** День выплаты — день операции, а у старых строк без него — день записи. */
export function payoutDay(row: Pick<PayoutLike, "occurred_on" | "created_at">): string {
  return row.occurred_on ?? row.created_at.slice(0, 10);
}

/** ВЫПЛАЧЕНО ЗА МЕСЯЦ — расходы, где он в строке «Кому» (`master_id` его
 *  карточки). Возврат выплаты (доход с тем же «Кому») её не уменьшает: такой
 *  операции в продукте нет, а чужой доход сюда не попадёт. */
export function payoutsOfMonth(rows: readonly PayoutLike[], now: Date): number {
  const ym = ymdOf(now).slice(0, 7);
  let sum = 0;
  for (const row of rows) {
    if (row.type !== "expense") continue;
    if (!payoutDay(row).startsWith(ym)) continue;
    sum += Math.abs(Number(row.amount) || 0);
  }
  return cents(sum);
}

/** Выплаты по месяцам, свежие сверху — страница «Выплаты». */
export function payoutsByMonth<R extends PayoutLike>(
  rows: readonly R[],
): { month: string; total: number; rows: R[] }[] {
  const byMonth = new Map<string, R[]>();
  for (const row of rows) {
    if (row.type !== "expense") continue;
    const month = payoutDay(row).slice(0, 7);
    const list = byMonth.get(month) ?? [];
    list.push(row);
    byMonth.set(month, list);
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([month, list]) => ({
      month,
      total: cents(list.reduce((sum, row) => sum + Math.abs(Number(row.amount) || 0), 0)),
      rows: list.sort((a, b) => payoutDay(b).localeCompare(payoutDay(a)) || b.created_at.localeCompare(a.created_at)),
    }));
}

function cents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
