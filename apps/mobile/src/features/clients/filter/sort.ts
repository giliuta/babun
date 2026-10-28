import type { Client } from "@babun/shared/local/clients";
import type { ClientStats } from "@babun/shared/local/selectors/client-stats";
import { visitMark } from "../visit-mark";

// Sort keys, their labels and the list comparator; the client debt formula
// lives here because the debt axis sorts by it. Pure, no React.

// ── Sort ───────────────────────────────────────────────────────────

export type SortKey =
  | "recent"
  | "stale"
  | "debt"
  | "revenue"
  | "expected"
  | "name";

/** ЗАКОН СОРТИРОВКИ: сортируем только по
 *  тому числу, которое НАПЕЧАТАНО в карточке списка, а подпись описывает
 *  ПЕРВУЮ карточку («Недавно были» — сверху свежий). Направление вшито
 *  в ключ: отдельной сущности «по возр./по убыв.» нет, двусторонней
 *  сделана одна ось «последняя запись» — обе её стороны рабочие («Давно не были» +
 *  «Без записи» = список на дозвон). Сортировка — первая строка листа
 *  «Фильтры», персистентна (sort-pref.ts), «Сбросить» её не трогает. */
export const SORT_LABELS_LONG: Record<SortKey, string> = {
  recent: "Недавно были",
  stale: "Давно не были",
  // Короткие имена осей («просто долг, доход» — «самый большой» многословно).
  // Больше — всегда сверху: обратной
  // стороны у денег не бывает, поэтому направление в подписи не нужно.
  debt: "Долг",
  revenue: "Доход",
  // Третье число карточки наконец стало осью: «Период: следующая неделя»
  // + эта ось = самые дорогие предстоящие работы сверху. Подпись НЕ
  // обещает «за период» — expectedRevenue суммирует все будущие записи.
  expected: "Ожидается",
  // Всё идёт по алфавитному порядку.
  name: "По алфавиту",
};

/** СОРТИРОВКА ПО УМОЛЧАНИЮ — по алфавиту: в фильтрах она выбрана сразу. */
export const DEFAULT_SORT: SortKey = "name";

export const SORT_ORDER: SortKey[] = [
  "name",
  "recent",
  "stale",
  "debt",
  "revenue",
  "expected",
];

/** Смысловые группы рядов попапа (волосок между блоками): алфавит —
 *  первым, он же умолчание · время · деньги. */
export const SORT_BLOCKS: SortKey[][] = [
  ["name"],
  ["recent", "stale"],
  ["debt", "revenue", "expected"],
];

/** ДОЛГ КЛИЕНТА — ОДНА ФОРМУЛА НА ВЕСЬ ПРОДУКТ: недоплата по ЗАВЕРШЁННЫМ
 *  визитам. Работа сделана, деньги не получены — больше долгу взяться неоткуда.
 *
 *  Ветки `balance < 0` нет: долг не может образоваться без записи — услуг
 *  не оказано. Колонка `clients.balance` в продукте МЁРТВАЯ: её не считает
 *  ни один экран и ни один триггер базы, попасть туда число может только
 *  импортом или правкой в БД. Печататься она как долг не должна — иначе это
 *  единственный способ показать задолженность человеку, которому не сделали
 *  ни одной работы.
 *
 *  Нельзя и соединять ветки через `else`: у клиента с долгом €50 по визиту и
 *  легаси-балансом −€200 показывалось бы €50; диспетчер принимал бы деньги —
 *  и на экране появлялось бы €200. Долг РОС бы после оплаты. */
export function clientDebt(_c: Client, s: ClientStats | undefined): number {
  // Округляем ЗДЕСЬ: копейки от округления сумм давали «долг €0» в
  // карточке и ложное попадание в статус «Должники».
  return Math.round(s?.debt ?? 0);
}

/** Сортировка списка клиентов. Ключи предвычисляются ОДНИМ проходом,
 *  дальше сравниваются числа/строки — statsMap не дёргается на каждое
 *  сравнение (2000 карточек ≈ 22 тыс. сравнений).
 *
 *  ПРАВИЛО ХВОСТА: у кого нет значения по активной оси (ни одного визита /
 *  нет долга / нет дохода) — вниз при ЛЮБОМ направлении. Фолбэка
 *  «lastVisitDate || created_at» нет: он ставил клиента «нет записей» выше
 *  обслуженного сегодня (ISO-время created_at длиннее и «больше» голой
 *  даты) и печатал «Недавний визит» над карточкой без визитов.
 *
 *  Тай-брейкеры: есть значение → значение → свежесть визита → добавлен →
 *  имя → id (детерминизм: список пересобирается после каждого синка,
 *  «дрожь» порядка была бы видна). Закреплённых сверху нет: закрепления у
 *  клиентов нет. */
export function sortClients(
  clients: Client[],
  statsMap: Map<string, ClientStats>,
  sort: SortKey,
): Client[] {
  const collator = new Intl.Collator("ru");
  const rows = clients.map((c) => {
    const s = statsMap.get(c.id);
    // ДАТА ВИЗИТА — ТА, ЧТО НАПЕЧАТАНА В СТРОКЕ (`visitMark`): строка
    // показывает и незакрытый прошедший визит (жёлтым), а сортировка по
    // одним закрытым ставила бы «28 сен» среди клиентов с «1 сен», а клиента с
    // одним незакрытым визитом уводила бы в хвост с датой в строке. Будущая запись (серым) визитом не считается — в хвост.
    const mark = visitMark(s);
    const last = mark && mark.kind !== "ahead" ? mark.date : "";
    let has = 1; // есть ли значение по активной оси
    let num = 0; // числовая ось (деньги)
    let str = ""; // строковая ось (даты)
    if (sort === "recent" || sort === "stale") {
      has = last ? 1 : 0;
      str = last;
    } else if (sort === "debt") {
      num = clientDebt(c, s);
      has = num > 0 ? 1 : 0;
    } else if (sort === "revenue") {
      num = s?.totalSpent ?? 0;
      has = num > 0 ? 1 : 0;
    } else if (sort === "expected") {
      num = s?.expectedRevenue ?? 0;
      has = num > 0 ? 1 : 0;
    } else {
      // Имя — тоже ось: безымянный клиент не имеет значения и уходит в
      // хвост, а не встаёт первым в «По алфавиту».
      has = c.full_name.trim() ? 1 : 0;
    }
    return { c, has, num, str, last };
  });
  // ISO-даты и uuid сравниваем строками напрямую — коллатор нужен только
  // именам (он на порядок дороже и на датах бессмыслен).
  rows.sort((a, b) => {
    if (a.has !== b.has) return b.has - a.has;
    if (a.has) {
      if (sort === "recent") {
        if (a.str !== b.str) return a.str < b.str ? 1 : -1;
      } else if (sort === "stale") {
        if (a.str !== b.str) return a.str < b.str ? -1 : 1;
      } else if (
        sort === "debt" ||
        sort === "revenue" ||
        sort === "expected"
      ) {
        if (a.num !== b.num) return b.num - a.num;
      } else {
        const n = collator.compare(a.c.full_name, b.c.full_name);
        if (n !== 0) return n;
      }
    }
    if (sort !== "recent" && sort !== "stale" && a.last !== b.last)
      return a.last < b.last ? 1 : -1;
    if (a.c.created_at !== b.c.created_at)
      return a.c.created_at < b.c.created_at ? 1 : -1;
    const byName = collator.compare(a.c.full_name, b.c.full_name);
    if (byName !== 0) return byName;
    return a.c.id < b.c.id ? -1 : a.c.id > b.c.id ? 1 : 0;
  });
  return rows.map((r) => r.c);
}
