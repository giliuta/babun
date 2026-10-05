// ФАКТЫ СТРАНИЦЫ ПАРТНЁРА — БЕЗ REACT (владелец 04.10, мозговой штурм
// страницы партнёра: «да, давай делай»). Был ли он в приложении и сколько
// денег прошло через его команды за месяц. Счёт проверяется тестом.

const MONTHS_SHORT = [
  "янв", "фев", "мар", "апр", "мая", "июн",
  "июл", "авг", "сен", "окт", "ноя", "дек",
];

const pad = (n: number) => String(n).padStart(2, "0");
const ymdOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

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

/** ВЫРУЧКА ЕГО КОМАНД ЗА ТЕКУЩИЙ МЕСЯЦ — по записям месяца. События и
 *  отменённые — не работа. Сколько получено, решает общее правило записи
 *  (`getPaidAmount`), его передаёт зовущий. */
export function monthReceived<R extends MoneyRow>(
  rows: readonly R[],
  teamIds: readonly string[],
  now: Date,
  paid: (row: R) => number,
): number {
  const teams = new Set(teamIds);
  const ym = ymdOf(now).slice(0, 7);
  let received = 0;
  for (const row of rows) {
    if (row.kind === "event" || row.status === "cancelled") continue;
    if (!row.team_id || !teams.has(row.team_id)) continue;
    if (row.date.startsWith(ym)) received += Math.max(0, paid(row));
  }
  return cents(received);
}

function cents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
