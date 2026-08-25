import type { FinanceTransaction } from "./transaction";

// НДС — ЧУЖИЕ ДЕНЬГИ ВНУТРИ ТВОИХ.
//
// Клиент платит 480: 400 — выручка компании, 80 — налог, который компания
// держит для государства. Если считать доходом все 480, прибыль завышена на
// 80, и в конце квартала выясняется, что часть «заработанного» надо отдать.
//
// Поставщику компания платит налог сама — он идёт В ЗАЧЁТ. Поэтому отдать
// нужно РАЗНИЦУ: собрал минус уплатил. Владелец 2026-08-09: «считать
// наперёд» — цифра должна быть видна всегда, а не всплывать в конце квартала.

export type VatMode = "off" | "inclusive" | "exclusive";

/** Как назначен налог КОНКРЕТНОЙ операции. Три клавиши, которые владелец
 *  жмёт руками: «Без НДС» — наличка от частника, «НДС включён» — цена уже с
 *  налогом, «Плюс НДС» — налог сверху введённой цены. */
export type TxVatMode = "none" | "inclusive" | "exclusive";

export const TX_VAT_MODE_LABELS: Record<TxVatMode, string> = {
  none: "Без НДС",
  inclusive: "НДС включён",
  exclusive: "Плюс НДС",
};

/** Режим операции по умолчанию — из действующей настройки (счёт → команда →
 *  компания). Выключенный НДС означает «без налога», а не «спроси ещё раз». */
export function defaultTxVatMode(settings: VatSettings): TxVatMode {
  if (settings.mode === "off" || !(settings.rate > 0)) return "none";
  return settings.mode;
}

export interface VatBreakdown {
  /** Что уйдёт в базу и ляжет на счёт. */
  gross: number;
  /** Налог внутри валовой суммы. 0 — операция без налога. */
  vat: number;
  /** Что останется компании. */
  net: number;
}

/**
 * Введённая сумма → то, что реально движется по счёту.
 *
 * Здесь единственное место, где «плюс НДС» превращает цену в деньги: при
 * exclusive человек вводит 400, а на счёт приходит 480. Считать это в UI
 * нельзя — тогда запись, инвойс и чек разойдутся на ставку.
 */
export function applyTxVat(
  input: number,
  mode: TxVatMode,
  rate: number,
): VatBreakdown {
  if (mode === "none" || !(rate > 0)) {
    return { gross: round2(input), vat: 0, net: round2(input) };
  }
  const gross = mode === "exclusive" ? grossFromNet(input, rate) : round2(input);
  const vat = vatFromGross(gross, rate);
  return { gross, vat, net: round2(gross - vat) };
}

/** Обратный ход для повторного открытия операции: в поле показываем то, что
 *  человек когда-то ввёл, а не то, что легло на счёт. */
export function inputFromGross(
  gross: number,
  mode: TxVatMode,
  rate: number,
): number {
  if (mode === "exclusive" && rate > 0) return netFromGross(gross, rate);
  return round2(gross);
}

export interface VatSettings {
  mode: VatMode;
  /** Процент. 19 — Кипр, 24 — Греция. */
  rate: number;
  /** МЁРТВОЕ ПОЛЕ (аудит 2026-08-16, U39): текст освобождения нигде не
   *  вводится и не печатается — из запросов и резолвера убран, колонки БД
   *  не тронуты. Ключ остаётся необязательным, пока литералы в чужих
   *  call sites его передают; убрать вместе с ними. */
  exemptionNote?: string | null;
}

export const VAT_OFF: VatSettings = { mode: "off", rate: 0 };

/** Переопределение НДС уровнем ниже компании: null — «наследовать выше». */
export interface VatOverride {
  mode: VatMode | null;
  rate: number | null;
}

/**
 * Действующий НДС для конкретной операции: счёт → команда → компания.
 *
 * КЛИЕНТСКОЕ ЗЕРКАЛО серверного триггера fill_transaction_vat: форма
 * показывает налог по этой формуле, а в базу его пишет триггер — разъезд
 * формул означал бы, что человек видит один налог, а в чек уходит другой.
 * Правила зеркалятся точно:
 * — тумблер компании «Работаем с НДС» = off гасит налог ВО ВСЁМ продукте,
 *   включая режим, закреплённый за счётом или командой (сервер так же
 *   проверяет t.vat_mode до coalesce — починка 2026-08-16);
 * — режим наследуется счёт → команда → компания, ставка — команда →
 *   компания: своей ставки у счёта нет намеренно, её задаёт страна работы
 *   команды, а счёт отвечает только «здесь налог есть или нет».
 *
 * Счёт побеждает команду не по прихоти: «счёт с НДС» — это про то, КУДА
 * приходят деньги. На расчётный падает выручка с налогом, а в кассу от
 * частника — без, и обе операции живут в одной команде.
 */
export function effectiveVatSettings(
  tenant: VatSettings | undefined,
  teamOverride: VatOverride | null | undefined,
  accountMode: VatMode | null | undefined,
): VatSettings {
  if (!tenant || tenant.mode === "off") return VAT_OFF;
  return {
    mode: accountMode ?? teamOverride?.mode ?? tenant.mode,
    rate: teamOverride?.rate ?? tenant.rate,
  };
}

// ─── ДЕНЬГИ СЧИТАЮТСЯ В ЦЕЛЫХ ЦЕНТАХ ────────────────────────────────────
//
// Сервер считает НДС на `numeric` — это точная десятичная арифметика с
// округлением ПОЛОВИНЫ ОТ НУЛЯ. Клиент считал те же формулы в double, и на
// ровной половине цента они расходились: 12,81 € при 20 % «включено» дают
// ровно 2,135 — сервер пишет 2,14, а `round2((12.81 * 20) / 120)` возвращает
// 2,13, потому что произведение в double уже 2,1349999999999998. Перебор
// 1…20000 центов на ставках 19/20/24 давал 493 таких точки в обоих режимах.
// Каждая из них — упавшее контрольное чтение ПОСЛЕ создания инвойса: документ
// есть, номер израсходован, человек видит ошибку выставления.
//
// Поэтому здесь нет float-арифметики вовсе: сумма переводится в целые центы,
// ставка — в сотые доли процента, умножение и деление идут на BigInt, а
// округление стоит РОВНО там же, где round(..., 2) на сервере.

/** Сумма → целые центы. Половина цента уходит ОТ НУЛЯ, как round() в
 *  Postgres. Допуск берётся ОТ ВЕЛИЧИНЫ, а не постоянный: 0,145 живёт в
 *  double как 14,499999999999998 цента, а 8,075 — как 807,4999999999999, и
 *  пыль растёт вместе с числом. Без поправки обе половины уехали бы вниз
 *  мимо сервера. */
export function moneyToCents(value: number): bigint {
  if (!Number.isFinite(value)) return 0n;
  const scaled = value * 100;
  const magnitude = Math.abs(scaled);
  const rounded = Math.round(magnitude + Number.EPSILON * magnitude);
  return BigInt(scaled < 0 ? -rounded : rounded);
}

/** Центы → сумма. Обратный ход к `moneyToCents`, единственный. */
export function centsToMoney(cents: bigint): number {
  return Number(cents) / 100;
}

/** Ставка в сотых долях процента: 19 → 1900. Сервер требует не больше двух
 *  знаков (`round(p_vat_percent, 2) is distinct from p_vat_percent`), так что
 *  целое здесь — не потеря точности, а то же самое число. */
function rateToHundredths(rate: number): bigint {
  if (!Number.isFinite(rate) || rate <= 0) return 0n;
  return BigInt(Math.round(rate * 100));
}

/**
 * Деление целых с округлением ПОЛОВИНЫ ОТ НУЛЯ — правило `round()` в Postgres.
 * Знак сохраняется: возврат уносит и налог, и сервер округляет −2,135 в −2,14.
 */
export function divideRoundHalfAwayFromZero(
  numerator: bigint,
  denominator: bigint,
): bigint {
  if (denominator <= 0n) return 0n;
  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;
  const quotient = (magnitude * 2n + denominator) / (denominator * 2n);
  return negative ? -quotient : quotient;
}

/** Налог ВНУТРИ валовой суммы, в центах. Зеркало серверного
 *  `round(amount * rate / (100 + rate), 2)` (триггер `fill_transaction_vat`)
 *  и равного ему `round(base - base / (1 + rate / 100), 2)` из `issue_invoice`. */
export function vatCentsFromGross(grossCents: bigint, rate: number): bigint {
  const rateHundredths = rateToHundredths(rate);
  if (rateHundredths <= 0n) return 0n;
  return divideRoundHalfAwayFromZero(
    grossCents * rateHundredths,
    10_000n + rateHundredths,
  );
}

/** Налог СВЕРХУ цены без налога, в центах. Зеркало серверного
 *  `round(base_total * vat_rate / 100, 2)`. */
export function vatCentsOnNet(netCents: bigint, rate: number): bigint {
  const rateHundredths = rateToHundredths(rate);
  if (rateHundredths <= 0n) return 0n;
  return divideRoundHalfAwayFromZero(netCents * rateHundredths, 10_000n);
}

/** Налог ВНУТРИ валовой суммы: 480 при ставке 20 → 80. */
export function vatFromGross(gross: number, rate: number): number {
  if (!(rate > 0)) return 0;
  return centsToMoney(vatCentsFromGross(moneyToCents(gross), rate));
}

/** Валовая сумма из цены БЕЗ налога: 400 при ставке 20 → 480.
 *  Налог считается отдельным слагаемым, а не множителем (1 + rate/100), —
 *  тогда «нетто + налог» и напечатанный налог сходятся по построению. */
export function grossFromNet(net: number, rate: number): number {
  if (!(rate > 0)) return net;
  const netCents = moneyToCents(net);
  return centsToMoney(netCents + vatCentsOnNet(netCents, rate));
}

/** Сколько из валовой суммы останется компании: 480 при ставке 20 → 400. */
export function netFromGross(gross: number, rate: number): number {
  const grossCents = moneyToCents(gross);
  return centsToMoney(grossCents - vatCentsFromGross(grossCents, rate));
}

/** Валовая цена для прайса: при «плюс НДС» налог добавляется сверху, при
 *  «включён» цена уже валовая. Одна точка — иначе итог записи и итог
 *  инвойса разойдутся на ставку. */
export function grossForPrice(price: number, settings: VatSettings): number {
  if (settings.mode === "exclusive") return grossFromNet(price, settings.rate);
  return price;
}

export interface VatSummary {
  /** Налог, собранный с клиентов (в доходах). */
  collected: number;
  /** Налог, уплаченный поставщикам (в расходах) — идёт в зачёт. */
  paid: number;
  /** Сколько отдать государству. Отрицательное — государство должно тебе. */
  due: number;
  /** Выручка без налога: то, что реально заработано. */
  netIncome: number;
}

/**
 * Сводка по НДС за набор операций.
 *
 * Переводы между своими счетами НЕ ТРОГАЕМ: деньги не меняют владельца,
 * налога там нет и быть не может. Возвраты приходят с отрицательной суммой
 * и таким же налогом — они сами уменьшают собранное.
 */
export function summarizeVat(
  transactions: readonly FinanceTransaction[],
): VatSummary {
  let collected = 0;
  let paid = 0;
  let netIncome = 0;
  for (const t of transactions) {
    if (t.type === "transfer") continue;
    // «Без НДС» нажато руками — снимку налога не верим, даже если он есть:
    // UPDATE-путь мог оставить осиротевший vat_amount, и отчёт насчитал бы
    // налог по операции, где оператор его явно выключил.
    const vat = t.vat_mode === "none" ? 0 : (t.vat_amount ?? 0);
    if (t.type === "income" || t.type === "refund") {
      // refund хранится отрицательным — суммирование само вычитает.
      collected += vat;
      netIncome += t.amount - vat;
    } else if (t.type === "expense") {
      paid += vat;
    }
  }
  return {
    collected: round2(collected),
    paid: round2(paid),
    due: round2(collected - paid),
    netIncome: round2(netIncome),
  };
}

/** Канон денежного округления: half-up, как numeric round в Postgres.
 *  EPSILON обязателен — без него float-пыль на ровной половине цента
 *  (0,045 → 0,04499…) роняла округление вниз, и превью расходилось с
 *  сохранённым сервером документом на цент. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
