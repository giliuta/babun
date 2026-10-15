// Row text and sums: the net of rows, the second line, search and captions.

import { money } from "@babun/shared/common/utils/money";
import {
  FORMS_DEN,
  FORMS_PLATEZH,
  formatCountRu,
} from "@babun/shared/common/utils/plural-ru";
import type { RecordRow, RowAccount } from "./types";

/**
 * ДВИЖЕНИЕ ДЕНЕГ ПО СТРОКАМ ЛЕНТЫ — одно правило на итог дня и на оборот
 * выбранного счёта за период (идея из отчёта по счетам).
 *
 * Складывается только пришедшее и ушедшее. Долг ещё не пришёл, а перевод,
 * обе ноги которого в ленте, переехал между показанными счетами — денег от
 * него не прибавилось. Перевод с одной ногой в ленте (`crossesSlice`) — для
 * этой ленты настоящий приход или расход и входит.
 *
 * `countEveryTone` — однородный список (долги): там сумма строк и есть итог.
 * Считается в центах: сумма десятков строк иначе копит float-пыль.
 */
export function rowsNet(
  rows: readonly Pick<RecordRow, "amount" | "tone" | "crossesSlice" | "extras">[],
  countEveryTone = false,
): number {
  let cents = 0;
  for (const row of rows) {
    // Склеенная запись несёт второстепенные деньги в `extras` (доход €135 и
    // материалы €10 одной работы). Итог дня считал только главную сумму и
    // терял расход: «€115» вместо €105. Долг — не деньги.
    if (!countEveryTone) {
      for (const extra of row.extras ?? []) {
        if (extra.tone === "expense") cents -= Math.round(Math.abs(extra.amount) * 100);
        else if (extra.tone === "income") cents += Math.round(Math.abs(extra.amount) * 100);
      }
    }
    if (
      !countEveryTone
      && (row.tone === "debt" || (row.tone === "transfer" && !row.crossesSlice))
    ) {
      continue;
    }
    cents += Math.round(row.amount * 100);
  }
  return cents / 100;
}

/** Сколько имён услуг печатаем целиком, прежде чем свернуть остаток в «+N». */
const SERVICES_SHOWN = 2;

/** ЧТО сделали — одной строкой. Усечение здесь ПРАВИЛО, а не `numberOfLines`
 *  наугад: без «+N» третья услуга съедала бы имя клиента. */
export function servicesLine(services: readonly string[]): string {
  if (services.length === 0) return "";
  const shown = services.slice(0, SERVICES_SHOWN).join(" · ");
  const rest = services.length - SERVICES_SHOWN;
  return rest > 0 ? `${shown} +${rest}` : shown;
}

/** КОГДА, ЧЕРЕЗ КАКОЙ СЧЁТ и ЧТО — одной строкой под именем клиента. Время
 *  здесь обязательно: по нему узнают работу. Дата не печатается — она заголовок
 *  дня.
 *
 *  СЧЁТ ИДЁТ ДО УСЛУГ. Строка в одну линию и режется
 *  многоточием с конца; счёт в хвосте первым и срезался — «11:30 · Chimney
 *  sweeping, Duct cleaning +2 · Нал…», и правило «в каждой заявке
 *  пишется, откуда взялись деньги» на обычном визите не выполнялось.
 *  Перечень услуг длинный и узнаётся по первому слову, счёт — одно-два
 *  коротких имени. */
export function whatLine(
  row: Pick<RecordRow, "time" | "services" | "subtitle" | "accounts" | "forDay">,
): string {
  return [
    row.time,
    accountsLine(row.accounts),
    row.forDay ? `за ${dayMonth(row.forDay)}` : "",
    row.subtitle || servicesLine(row.services),
  ]
    .filter(Boolean)
    .join(" · ");
}

const MONTHS_GEN = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

/** «1 октября» из YYYY-MM-DD — без часового пояса, строкой. */
function dayMonth(ymd: string): string {
  const [, m, d] = ymd.split("-").map(Number);
  return m && d ? `${d} ${MONTHS_GEN[m - 1]}` : ymd;
}

/** Лента ОДНОГО выбранного счёта имени счёта в строках не повторяет: оно уже
 *  стоит заголовком ленты («НАЛИЧНЫЕ · 5»), а повтор одного и того же
 *  лишний шум. Перевод своё «Наличные → Карта» держит — это не имя
 *  выбранного счёта, а куда ушли деньги. */
export function dropAccountNames(rows: readonly RecordRow[]): RecordRow[] {
  return rows.map((row) => (row.accounts ? { ...row, accounts: undefined } : row));
}

/** Имена счетов строки: каждое один раз, в порядке плиток счетов. Порядок не
 *  зависит от того, какой платёж пришёл первым, — иначе один и тот же визит
 *  читался бы то «Наличные · Карта», то «Карта · Наличные». Два счёта с одним
 *  именем в разных командах печатаются одним словом: строка называет, где
 *  деньги, а чья команда — говорит чип над экраном. */
export function accountsLine(
  accounts: readonly RowAccount[] | undefined,
): string {
  if (!accounts?.length) return "";
  const names: string[] = [];
  for (const tag of [...accounts].sort((a, b) => a.rank - b.rank)) {
    if (!names.includes(tag.name)) names.push(tag.name);
  }
  return names.join(" · ");
}

/** Сумма «как напечатано» и сумма «как хранится» — один канон для сравнения:
 *  без пробелов (лента ставит неразрывный U+00A0), без €, запятая → точка. */
const canonMoney = (s: string) => s.replace(/[\s€]/g, "").replace(/,/g, ".");

/** ПОИСК ИЩЕТ ТО, ЧТО ВИДНО В СТРОКЕ: клиент, услуги, сумма и счёт. Поле
 *  поиска обещает «Сумма, счёт, заметка», поэтому счёт печатается в строке — иначе
 *  искать по нему было бы нельзя. Пустой запрос пропускает всё. */
export function rowMatchesQuery(row: RecordRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const includes = (text: string) => text.toLowerCase().includes(needle);
  return (
    includes(row.title) ||
    row.services.some(includes) ||
    (row.subtitle ? includes(row.subtitle) : false) ||
    (row.accounts ?? []).some((tag) => includes(tag.name)) ||
    canonMoney(money(Math.abs(row.amount))).includes(canonMoney(needle))
  );
}

/** Правая подпись, когда состояние одно: число платежей, если их несколько. */
export function paymentsLine(row: Pick<RecordRow, "count">): string {
  return row.count > 1 ? formatCountRu(row.count, FORMS_PLATEZH) : "";
}

/** ВОЗРАСТ ДОЛГА — ГЛАВНЫЙ ПРИЗНАК СРОЧНОСТИ. Список долгов открывают, чтобы
 *  решить, кому звонить; вчерашний долг и месячный требуют разного, а на
 *  экране без возраста они неотличимы. Дату не печатаем: она уже стоит
 *  заголовком дня, и в строке была бы вторым экземпляром того же
 *  (дата и так сверху). */
export function debtAge(date: string, today: string): string {
  const days = daysBetween(date, today);
  if (days <= 0) return "сегодня";
  if (days === 1) return "вчера";
  return formatCountRu(days, FORMS_DEN);
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}
