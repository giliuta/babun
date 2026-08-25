import type {
  InvoiceLedgerWithLines,
  InvoiceVatMode,
} from "@babun/shared/local/finance/invoice-ledger";
import { getCurrentTimeInZone } from "@babun/shared/common/utils/date-utils";
import {
  money,
  moneySymbol,
  parseMoneyInputToCents,
} from "@babun/shared/common/utils/money";

/**
 * ДЕНЬГИ ДОКУМЕНТА ГОВОРЯТ НА ЯЗЫКЕ ДОКУМЕНТА (2026-08-25).
 *
 * Русский счёт печатает «€1 234,50», английский — «€1,234.50»: это не
 * украшение, а то, как число читают. Внутри приложения денежная грамматика
 * по-прежнему одна на весь продукт (`money`), и русская ветка буквально она —
 * иначе рядом появилась бы вторая правда о том, как выглядит евро.
 */
export function formatInvoiceMoney(
  value: number,
  currency: string = "EUR",
  locale = "ru-RU",
): string {
  if (locale === "ru-RU") return money(value, currency);
  if (!Number.isFinite(value)) return "—";
  const symbol = moneySymbol(currency);
  const prefix = symbol.length > 1 ? `${symbol}\u00a0` : symbol;
  const cents = Math.round(value * 100);
  const abs = Math.abs(cents);
  const body = new Intl.NumberFormat(locale, {
    minimumFractionDigits: abs % 100 ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(abs / 100);
  return `${cents < 0 ? "−" : ""}${prefix}${body}`;
}

export function formatInvoiceDate(
  value: string | null,
  locale = "ru-RU",
  fallback = "Не указан",
): string {
  if (!value) return fallback;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

export function parseDecimal(value: string): number | null {
  const normalized = value.replace(/\s/g, "").replace(",", ".");
  if (!normalized || !/^\d+(?:\.\d{0,3})?$/.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

/**
 * Денежный ввод инвойсного контура — тонкая обёртка над общим
 * `parseMoneyInputToCents`: один парсер на весь продукт, иначе сумма, которую
 * лист операции честно отклоняет (за пределами numeric(12,2)), в оплате
 * инвойса проходила бы клиентскую проверку и падала уже на сервере.
 * Инвойсы считают в евро-числах, поэтому центы возвращаются делением.
 * Ноль разрешён: бесплатная строка позиции — легальна, её режет валидация
 * итога, а не парсер.
 */
export function parseMoneyAmount(value: string): number | null {
  const cents = parseMoneyInputToCents(value, { allowZero: true });
  return cents == null ? null : cents / 100;
}

export function invoiceVatMode(invoice: InvoiceLedgerWithLines): InvoiceVatMode {
  if (invoice.vat_percent <= 0 || invoice.vat_amount <= 0) return "off";
  const lineTotal = invoice.lines.reduce((sum, line) => sum + line.total, 0);
  return Math.abs(lineTotal - invoice.total) < Math.abs(lineTotal - invoice.subtotal_net)
    ? "inclusive"
    : "exclusive";
}

export function todayYmd(timeZone?: string): string {
  let now = new Date();
  if (timeZone) {
    try {
      // Keep the client fallback identical to the database RPC when a stale
      // or manually-corrupted timezone reaches the device.
      new Intl.DateTimeFormat("en-US", { timeZone }).format(now);
      now = getCurrentTimeInZone(timeZone);
    } catch {
      now = getCurrentTimeInZone("Europe/Nicosia");
    }
  }
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
}

export function addDaysYmd(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}
