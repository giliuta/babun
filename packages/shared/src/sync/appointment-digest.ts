// ОТПЕЧАТОК ЗАПИСЕЙ ПО МЕСЯЦАМ — ТОТ ЖЕ РАСЧЁТ, ЧТО У СЕРВЕРА.
//
// Сервер (`appointment_month_digest`, 20261028180000) отвечает на месяц —
// `left(date, 7)` — числом записей и суммой хэшей строк по модулю
// P = 2^31 − 1. Телефон считает то же по своему кэшу: месяц, где число или
// сумма разошлись, перечитывается целиком, остальные не трогаются. Так
// ловится всё, чего не видит дельта по `updated_at`: удаление любым путём,
// запись, ставшая невидимой, пропущенная дельта.
//
// Хэш строки — целочисленный, без md5 (библиотеки хэшей в приложении нет):
//   c0..c3 — четыре 32-битных куска hex `id`, u — `updated_at` в
//   микросекундах; h = Σ (cᵢ mod P)·Mᵢ mod P + (u mod P)·M4 mod P, всё mod P.
// Произведения выходят за 2^53, поэтому — BigInt (как в `invoice-ledger.ts`).
// Совпадение с SQL держит `appointment-digest.test.ts` на строках и
// отпечатках, посчитанных боевой функцией.

const P = 2147483647n;
const M = [16777619n, 805306457n, 1610612741n, 402653189n, 201326611n] as const;

/** `updated_at` из ответа PostgREST («2026-10-28T14:08:18.61043+00:00») — в
 *  микросекундах с 1970 года. `Date` хранит только миллисекунды, поэтому
 *  дробь секунды берётся из строки. Нечитаемая строка — `null`: такой месяц
 *  сверка сочтёт разошедшимся и перечитает (ошибка только в сторону чтения). */
export function updatedAtMicros(iso: string): bigint | null {
  const m = /^(\d{4}-\d\d-\d\d)[T ](\d\d:\d\d:\d\d)(?:\.(\d{1,6}))?(Z|[+-]\d\d(?::?\d\d)?)$/.exec(iso);
  if (!m) return null;
  const zone = m[4] === "Z" ? "Z" : m[4].length === 3 ? `${m[4]}:00` : m[4].replace(/^([+-]\d\d)(\d\d)$/, "$1:$2");
  const seconds = Date.parse(`${m[1]}T${m[2]}${zone}`);
  if (Number.isNaN(seconds)) return null;
  const micros = BigInt((m[3] ?? "").padEnd(6, "0"));
  return BigInt(seconds) * 1000n + micros;
}

/** Хэш одной строки (id, updated_at) — как `row_hash` в SQL. */
export function appointmentRowHash(id: string, updatedAt: string): bigint | null {
  const hex = id.replace(/-/g, "").toLowerCase();
  const u = updatedAtMicros(updatedAt);
  if (!/^[0-9a-f]{32}$/.test(hex) || u == null) return null;
  let h = 0n;
  for (let i = 0; i < 4; i++) {
    const c = BigInt(`0x${hex.slice(i * 8, i * 8 + 8)}`) % P;
    h += (c * M[i]) % P;
  }
  h += ((u % P) * M[4]) % P;
  return h % P;
}

export type MonthDigest = { n: number; digest: number };

/** Отпечатки месяцев по строкам кэша. Строка без читаемого хэша портит свой
 *  месяц (`digest = -1`), и он уйдёт на перечитку. */
export function monthDigests(
  rows: readonly { id: string; date: string; updated_at?: string | null }[],
): Map<string, MonthDigest> {
  const sums = new Map<string, { n: number; sum: bigint; broken: boolean }>();
  for (const row of rows) {
    const month = row.date.slice(0, 7);
    const acc = sums.get(month) ?? { n: 0, sum: 0n, broken: false };
    const h = row.updated_at ? appointmentRowHash(row.id, row.updated_at) : null;
    acc.n += 1;
    if (h == null) acc.broken = true;
    else acc.sum += h;
    sums.set(month, acc);
  }
  const out = new Map<string, MonthDigest>();
  for (const [month, acc] of sums) {
    out.set(month, { n: acc.n, digest: acc.broken ? -1 : Number(acc.sum % P) });
  }
  return out;
}

/** Месяцы, которые надо перечитать: разошлись число или сумма, есть только
 *  у сервера (новые для телефона) или только у телефона (на сервере их
 *  больше нет — удалены или стали невидимы). */
export function monthsToRefetch(
  local: ReadonlyMap<string, MonthDigest>,
  server: readonly { month: string; n: number; digest: number | string }[],
): string[] {
  const out = new Set<string>();
  const seen = new Set<string>();
  for (const row of server) {
    seen.add(row.month);
    const mine = local.get(row.month);
    if (!mine || mine.n !== row.n || mine.digest !== Number(row.digest)) out.add(row.month);
  }
  for (const month of local.keys()) if (!seen.has(month)) out.add(month);
  return [...out].sort();
}

/** Границы месяца «YYYY-MM» для чтения по `date` (текст «YYYY-MM-DD»). */
export function monthBounds(month: string): { from: string; to: string } {
  return { from: `${month}-01`, to: `${month}-31` };
}
