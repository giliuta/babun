// Small text helpers of the paper: money, dates, quantities, address lines.

/** Адрес так, как его набрали: перенос строки в реквизитах — перенос на
 *  бумаге (лист реквизитов это обещает подписью под полем). */
export function addressLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** ДЕНЬГИ НА БУМАГЕ — ВСЕГДА С КОПЕЙКАМИ: «€50.00», как на инвойсе AirFix
 *  #103. Экраны приложения печатают «€50» (`formatInvoiceMoney`) — там это
 *  стиль продукта, а в документе клиенту круглая сумма без копеек читается
 *  как незаполненная колонка. */
export function paperMoney(value: number, currency = "EUR", locale = "ru-RU"): string {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/** «18/09/2026» для en-GB, «18.09.2026» для ru-RU — как в шапке #103. */
export function shortDate(ymd: string | null, locale: string): string {
  if (!ymd) return "";
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function prefixed(label: string, value: string): string {
  return value ? `${label}: ${value}` : "";
}

export function compact(values: string[]): string[] {
  return values.filter((value) => value.length > 0);
}

export function firstNonEmpty(...values: (string | null | undefined)[]): string {
  for (const value of values) {
    const normalized = clean(value);
    if (normalized) return normalized;
  }
  return "";
}

export function joinParts(...values: (string | null | undefined)[]): string {
  return values.map(clean).filter(Boolean).join(", ");
}

export function clean(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

/** «4 м» вместо голого «4» (2026-08-25). Колонка «Кол-во» печатала число без
 *  подписи, и на проде это уже вышло боком: человек вписал метры в НАЗВАНИЕ
 *  позиции — «Трасса, 4 м», — потому что сказать их было больше негде.
 *  Единица берётся из СТРОКИ СЧЁТА, а не из прайса: выставленный документ
 *  заморожен, и смена единицы у услуги через месяц не переписывает бумагу,
 *  которую клиент уже получил. */
export function formatQty(
  value: number,
  unit?: string | null,
  locale = "ru-RU",
): string {
  const number = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 3,
  }).format(value);
  const suffix = unit?.trim();
  return suffix ? `${number} ${suffix}` : number;
}

export function formatPercent(value: number, locale = "ru-RU"): string {
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value)}%`;
}
