// Деньги печатаются в одном месте — иначе каждый экран заводит свою
// грамматику, и на одной странице встречаются «€940» и «0 €».
//
// Валюта — свойство тенанта (`tenants.currency`), поэтому она приходит
// параметром, а не зашита в имя функции: ни один форматтер не имеет права
// печатать € у тенанта, который работает в гривне.
//
// Грамматика чисел одна на весь продукт: символ перед числом, неразрывный
// пробел разрядов, запятая десятичная, копейки только когда они есть,
// минус U+2212 (не дефис), ноль всегда без знака.

const NB = "\u00A0"; // неразрывный пробел: число не рвётся по разрядам

// PostgreSQL money columns in the finance schema use numeric(12,2): ten
// integer digits plus cents. Keep this boundary shared by UI parsers and
// repositories so neither JavaScript nor Postgres silently rounds a value.
export const MAX_MONEY_CENTS = 999_999_999_999;

export interface MoneyInputOptions {
  allowNegative?: boolean;
  allowZero?: boolean;
}

/** Валюта тенанта: `tenants.currency` допускает ровно эти пять кодов. */
export type MoneyCurrency = "EUR" | "USD" | "RUB" | "UAH" | "GBP";

export const DEFAULT_CURRENCY: MoneyCurrency = "EUR";

const CURRENCY_SYMBOL: Record<MoneyCurrency, string> = {
  EUR: "€",
  USD: "$",
  RUB: "₽",
  UAH: "₴",
  GBP: "£",
};

/**
 * Символ валюты тенанта — для префикса суммы в полях ввода и заголовках.
 *
 * Своя таблица, а не `Intl`: `Intl.NumberFormat("ru-RU")` ставит символ
 * ПОСЛЕ числа («0 €»), и один и тот же экран показывал рядом «€940» и «0 €».
 * Незнакомый код печатаем как есть — это честнее подставленного евро в
 * продукте, где валюта настраивается.
 */
export function moneySymbol(currency: string | null | undefined): string {
  const code = (currency ?? "").trim().toUpperCase();
  if (!code) return CURRENCY_SYMBOL.EUR;
  return CURRENCY_SYMBOL[code as MoneyCurrency] ?? code;
}

function groupDigits(whole: number): string {
  return whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, NB);
}

/**
 * Знак суммы по ОКРУГЛЁННЫМ центам — единственный допустимый способ
 * покрасить и подписать цифру.
 *
 * `amount < 0` красит красным −0,004: на экране стоит «€0», а цвет говорит
 * «минус». Сравнивать надо ровно то, что напечатано.
 */
export function moneySign(amount: number): -1 | 0 | 1 {
  if (!Number.isFinite(amount)) return 0;
  const cents = Math.round(amount * 100);
  return cents > 0 ? 1 : cents < 0 ? -1 : 0;
}

/** Сумма в валюте тенанта: «€1 234,50», «₴0», «−$310». */
export function money(
  value: number,
  currency: string = DEFAULT_CURRENCY,
): string {
  if (!Number.isFinite(value)) return "—";
  const symbol = moneySymbol(currency);
  // Незнакомый код отбивается пробелом: «PLN 1 200» читается, «PLN1 200» нет.
  const prefix = symbol.length > 1 ? `${symbol}${NB}` : symbol;
  const cents = Math.round(value * 100);
  const abs = Math.abs(cents);
  const fraction = abs % 100;
  const body = `${prefix}${groupDigits(Math.floor(abs / 100))}${
    fraction ? `,${String(fraction).padStart(2, "0")}` : ""
  }`;
  return cents < 0 ? `−${body}` : body;
}

/** «+€3 240» / «−€310» / «€0» — знак нужен там, где цифра означает движение
 *  («Пришло за август»). Ноль движением не является и знака не получает. */
export function formatSignedMoneyExact(
  amount: number,
  currency: string = DEFAULT_CURRENCY,
): string {
  if (!Number.isFinite(amount)) return "—";
  const sign = moneySign(amount);
  if (sign === 0) return money(0, currency);
  return `${sign > 0 ? "+" : "−"}${money(Math.abs(amount), currency)}`;
}

/** Значение для поля ввода: «1234,50». Без символа и без разрядных пробелов
 *  (их пришлось бы вычищать на каждом нажатии) и всегда с копейками — иначе
 *  непонятно, потерялись они или их не было. */
export function formatMoneyForInput(amount: number): string {
  if (!Number.isFinite(amount)) return "";
  const cents = Math.round(amount * 100);
  const abs = Math.abs(cents);
  const body = `${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
  return cents < 0 ? `−${body}` : body;
}

// Символы валют вычищаются из ввода тем же списком, которым печатаются:
// сумму вставляют скопированной из сообщения, а не набирают заново.
const CURRENCY_CHARS = new RegExp(
  `[${Object.values(CURRENCY_SYMBOL).join("")}]`,
  "g",
);

// Европейская группировка точками распознаётся только целиком — точки
// строго по три цифры И запятая с копейками. Без запятой «1.005» остаётся
// попыткой ввести три знака после точки и обязано быть отвергнуто, а не
// молча превращено в тысячу.
const EUROPEAN_GROUPED = /^-?\d{1,3}(?:\.\d{3})+,\d{1,2}$/;

/**
 * Привести человеческий ввод к машинному «-1234.56».
 *
 * Форматтер печатает минус U+2212 — значит парсер обязан его понимать,
 * иначе сумма, скопированная с соседнего экрана, не вводится обратно.
 * En dash сюда попадает из автозамены iOS.
 */
function normalizeMoneyInput(value: string): string {
  const cleaned = value
    .replace(/\s/g, "") // \s покрывает NBSP и узкие пробелы разрядов
    .replace(CURRENCY_CHARS, "")
    .replace(/[−–]/g, "-");
  const degrouped = EUROPEAN_GROUPED.test(cleaned)
    ? cleaned.replace(/\./g, "")
    : cleaned;
  return degrouped.replace(",", ".");
}

/**
 * Parse a user-entered decimal amount into exact integer cents.
 *
 * Comma and dot are accepted as decimal separators. Exponents, mixed
 * separators, more than two fractional digits and values outside numeric(12,2)
 * are rejected instead of being coerced or rounded.
 */
export function parseMoneyInputToCents(
  value: string,
  options: MoneyInputOptions = {},
): number | null {
  const normalized = normalizeMoneyInput(value);
  const signPattern = options.allowNegative ? "-?" : "";
  if (!new RegExp(`^${signPattern}\\d+(?:\\.\\d{1,2})?$`).test(normalized)) {
    return null;
  }

  const negative = normalized.startsWith("-");
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [whole, fraction = ""] = unsigned.split(".");
  const cents =
    Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents > MAX_MONEY_CENTS) return null;

  const signedCents = negative ? -cents : cents;
  if (!options.allowZero && signedCents === 0) return null;
  return signedCents;
}

/** Convert a programmatic amount to cents only when it is exactly representable. */
export function exactMoneyAmountToCents(
  amount: number,
  options: MoneyInputOptions = {},
): number | null {
  if (!Number.isFinite(amount)) return null;
  const scaled = amount * 100;
  const cents = Math.round(scaled);
  // Normal binary floating-point noise is much smaller than this tolerance;
  // a real third decimal (for example 1.005) remains far outside it.
  if (Math.abs(scaled - cents) > 1e-6) return null;
  if (!Number.isSafeInteger(cents) || Math.abs(cents) > MAX_MONEY_CENTS) {
    return null;
  }
  if (!options.allowNegative && cents < 0) return null;
  if (!options.allowZero && cents === 0) return null;
  return cents;
}

/** Округлённая до целых сумма: сводки и заголовки, где копейки — шум. */
export function formatEUR(amount: number): string {
  return money(Math.round(amount));
}

/** Сумма с копейками: остатки, лента операций, инвойсы. Историческое имя —
 *  зовётся из 59 мест и переезжает на `money(value, currency)` по мере того,
 *  как до экрана доходит валюта тенанта. */
export function formatEURExact(amount: number): string {
  return money(amount);
}
