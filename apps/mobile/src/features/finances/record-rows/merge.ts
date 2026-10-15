import type { RecordRow } from "./types";

// ОДНА ЗАПИСЬ — ОДНА СТРОКА, ДАЖЕ КОГДА СОСТОЯНИЙ НЕСКОЛЬКО: это не две сделки, а
// одна запись, в которой может быть расход, доход и долг.
//
// В общей ленте визит с доходом и остатком долга давал ДВЕ строки, с
// материалами — три, и одна работа читалась как три дела. Та же ошибка, что с
// девятнадцатью проводками, только уровнем выше.
//
// Правило: ГЛАВНОЕ ЧИСЛО — деньги, которые ПРИШЛИ. По нему считается итог дня
// и сходится плитка «Доход»; если бы главным была стоимость работ, день
// показывал бы деньги, которых в кассе нет. Прихода не было — главным
// становится то, что есть: долг или расход. Остальные состояния той же работы
// уходят в подпись: «долг €7 · расход €10».
//
// Разрезы этой склейки НЕ используют: тапнув «Долги», человек хочет долги, а
// не записи с долгом внутри.

/** Кто главнее, когда у записи несколько состояний. Деньги, которые ПРИШЛИ,
 *  важнее всего; следом долг — он про клиента и требует действия; расход по
 *  материалам замыкает: он уже случился и решения не ждёт. */
const TONE_ORDER: NonNullable<RecordRow["tone"]>[] = [
  "income",
  "debt",
  "expense",
];

export function mergeByRecord(rows: readonly RecordRow[]): RecordRow[] {
  const byRecord = new Map<string, RecordRow[]>();
  const singles: RecordRow[] = [];

  for (const row of rows) {
    if (!row.appointmentId) {
      singles.push(row);
      continue;
    }
    const group = byRecord.get(row.appointmentId);
    if (group) group.push(row);
    else byRecord.set(row.appointmentId, [row]);
  }

  const merged = [...byRecord.values()].map((group) => {
    if (group.length === 1) return group[0];
    // Одно состояние может прийти несколькими строками (доход и его же
    // материалы уже сложены раньше, но подстраховка дешевле разъехавшейся
    // суммы): складываем внутри тона, потом выбираем главный.
    const sums = new Map<NonNullable<RecordRow["tone"]>, number>();
    for (const row of group) {
      const tone = row.tone ?? "income";
      sums.set(tone, (sums.get(tone) ?? 0) + row.amount);
    }
    const present = TONE_ORDER.filter((tone) => sums.has(tone));
    const headTone = present[0];
    const head =
      group.find((row) => (row.tone ?? "income") === headTone) ?? group[0];
    const extras = present.slice(1).map((tone) => ({
      tone,
      amount: Math.abs(sums.get(tone) ?? 0),
    }));
    // Счета склеенной строки — все, через которые шли деньги этой работы:
    // доход пришёл на карту, материалы ушли наличными — «Наличные · Карта».
    const accounts = group.flatMap((row) => row.accounts ?? []);
    return {
      ...head,
      accounts: accounts.length > 0 ? accounts : undefined,
      key: `rec:${head.appointmentId}`,
      amount: Math.round((sums.get(headTone) ?? 0) * 100) / 100,
      tone: headTone,
      // Подпись уступает место тому, что ещё не закрыто: возраст человек
      // прикинет по дню списка, а «сколько ещё должны» — нет.
      caption: extras.length > 0 ? undefined : head.caption,
      extras: extras.length > 0 ? extras : undefined,
      count: group.reduce((sum, row) => sum + row.count, 0),
    };
  });

  return [...merged, ...singles].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    const at = a.time ?? "";
    const bt = b.time ?? "";
    if (at !== bt) return at < bt ? 1 : -1;
    return a.key < b.key ? 1 : -1;
  });
}
