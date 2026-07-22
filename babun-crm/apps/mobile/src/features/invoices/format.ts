import type {
  InvoiceLedgerWithLines,
  InvoiceVatMode,
} from "@babun/shared/local/finance/invoice-ledger";
import { getCurrentTimeInZone } from "@babun/shared/common/utils/date-utils";
import { formatEURExact } from "@babun/shared/common/utils/money";

export function formatInvoiceMoney(value: number, currency = "EUR"): string {
  // Finance, client balances and invoices use one visual money grammar:
  // sign + symbol + amount. Intl ru-RU puts EUR after the number (`0 €`),
  // which made the same dashboard show both `€940` and `0 €` side by side.
  if (currency.toUpperCase() === "EUR") return formatEURExact(value);
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency,
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatInvoiceDate(value: string | null): string {
  if (!value) return "Не указан";
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ru-RU", {
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

export function parseMoneyAmount(value: string): number | null {
  const normalized = value.replace(/\s/g, "").replace(",", ".");
  if (!normalized || !/^\d+(?:\.\d{0,2})?$/.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
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
