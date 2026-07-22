// EUR formatting helpers — one place so every page renders money the
// same way.
//
// Cyprus uses the Eurozone convention: € sign BEFORE the number, space
// separator for thousands (narrow no-break space so digits don't line
// break mid-number). Negatives get a unicode minus (−), not a hyphen.

const NB = "\u00A0"; // narrow no-break space for thousands separator

// PostgreSQL money columns in the finance schema use numeric(12,2): ten
// integer digits plus cents. Keep this boundary shared by UI parsers and
// repositories so neither JavaScript nor Postgres silently rounds a value.
export const MAX_MONEY_CENTS = 999_999_999_999;

export interface MoneyInputOptions {
  allowNegative?: boolean;
  allowZero?: boolean;
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
  const normalized = value.replace(/\s/g, "").replace(",", ".");
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

export function formatEUR(amount: number): string {
  const rounded = Math.round(amount);
  const abs = Math.abs(rounded);
  const grouped = abs
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, NB);
  return rounded < 0 ? `−€${grouped}` : `€${grouped}`;
}

/** Exact two-decimal display for ledgers, balances and invoice-adjacent UI. */
export function formatEURExact(amount: number): string {
  if (!Number.isFinite(amount)) return "—";
  const roundedCents = Math.round(amount * 100);
  const absCents = Math.abs(roundedCents);
  const whole = Math.floor(absCents / 100);
  const fraction = absCents % 100;
  const grouped = whole
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, NB);
  const body = fraction
    ? `€${grouped},${String(fraction).padStart(2, "0")}`
    : `€${grouped}`;
  return roundedCents < 0 ? `−${body}` : body;
}

/**
 * Format a cents-integer as euros. Use this at every boundary where the
 * stored value is `amountCents` (FinancePayment, Expense, PayrollLine)
 * — feeding cents into `formatEUR` directly renders €X 100× too big
 * and has shipped silently on /expenses, /payroll, /brigades (#B2 of
 * Sprint 011).
 */
export function formatEURFromCents(cents: number): string {
  return formatEUR(Math.round(cents / 100));
}

export function formatEURSignedFromCents(cents: number): string {
  return formatEURSigned(Math.round(cents / 100));
}

/**
 * Same as formatEUR but with an explicit leading sign. Useful for
 * "delta" displays where we want a + shown even for positive values.
 */
export function formatEURSigned(amount: number): string {
  const rounded = Math.round(amount);
  if (rounded === 0) return "€0";
  const body = formatEUR(Math.abs(rounded));
  return rounded > 0 ? `+${body}` : `−${body}`;
}

export function formatPercentDelta(pct: number): string {
  if (Number.isNaN(pct)) return "—";
  // `percentDelta` returns +Infinity when prev was zero and current > 0 —
  // i.e. there's no comparable previous period. "нов." is more honest
  // than "+100 %" (which was the old silent lie).
  if (pct === Number.POSITIVE_INFINITY) return "нов.";
  if (pct === Number.NEGATIVE_INFINITY) return "—";
  const r = Math.round(pct);
  if (r === 0) return "0%";
  return r > 0 ? `+${r}%` : `${r}%`;
}
