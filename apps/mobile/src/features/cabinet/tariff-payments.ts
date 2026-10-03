import { money } from "@babun/shared/common/utils/money";
import { tierName, type Tier } from "@/features/tariffs/tiers";

// «ОПЛАТЫ ТАРИФА» — ЧИСТЫЙ СЛОЙ (владелец 03.10: «оплаты тарифа — да, надо»).
//
// Историю оплат ведёт не приложение, а вебхук Stripe: он пишет каждое событие
// в `billing_events` целиком (`payload` — событие как пришло, счёт лежит в
// `payload.data.object`). Здесь событие читается в строку страницы.
//
// Читать приходится ОСТОРОЖНО: форму счёта определяет версия API Stripe, а не
// мы, и любое поле может не прийти (у `basil` цена строки переехала, у старых
// счетов нет ссылок). Поэтому разбор ничего не предполагает — нет поля, значит
// строка без этой подписи, а не падение страницы.
//
// ЧТО В ЛЕНТЕ ОПЛАТ, А ЧТО НЕТ:
//   • счёт на 0 — не оплата: так Stripe оформляет начало пробного периода и
//     возврат при смене тарифа, денег в нём нет;
//   • повторы одной неудачной оплаты (Stripe пробует списать до четырёх раз)
//     склеиваются в одну строку — последнюю; удачная оплата того же счёта
//     остаётся рядом, это и есть рассказ «не прошла, потом прошла».
//
// Суммы Stripe хранит в центах, а тарифы у нас только в евро (`tariff-checkout`),
// поэтому «÷ 100» без таблицы валют без десятичных знаков.

/** События Stripe, из которых складывается лента. */
export const PAYMENT_EVENTS = ["invoice.payment_succeeded", "invoice.payment_failed"] as const;

/** Строка `billing_events` так, как её отдаёт запрос. */
export interface BillingEventRow {
  id: string;
  event_type: string;
  payload: unknown;
  processed_at: string | null;
}

export interface TariffPayment {
  id: string;
  /** Счёт Stripe (`in_…`): по нему склеиваются повторы неудачной оплаты. */
  invoiceId: string | null;
  failed: boolean;
  /** Евро, а не центы; `null` — в событии суммы нет. */
  amount: number | null;
  /** Код валюты счёта, заглавными. */
  currency: string;
  /** Когда списали (или когда списание не прошло), мс. */
  at: number;
  /** Тариф, если удалось узнать. */
  tier: Tier | null;
  /** «Про» — или описание строки счёта, когда тариф не опознан. */
  title: string;
  /** За какой срок оплата, мс; оба края или ни одного. */
  periodStart: number | null;
  periodEnd: number | null;
  /** Чек Stripe, иначе pdf счёта; только https. */
  url: string | null;
}

type Rec = Record<string, unknown>;

const rec = (value: unknown): Rec | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Rec) : null;

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** Время Stripe — секунды Unix; ноль и мусор — «нет времени». */
const unixMs = (value: unknown): number | null => {
  const seconds = num(value);
  return seconds !== null && seconds > 0 ? seconds * 1000 : null;
};

const httpsUrl = (value: unknown): string | null => {
  const url = text(value);
  return url && /^https:\/\//i.test(url) ? url : null;
};

function asTier(value: unknown): Tier | null {
  return value === "solo" || value === "pro" || value === "max" ? value : null;
}

const TIER_WORDS = new Map<string, Tier>([
  ["соло", "solo"],
  ["про", "pro"],
  ["макс", "max"],
]);

/** Тариф по словам («Про · месяц», «1 × Babun Макс (at …)»): целое слово. */
function tierInWords(value: string | null): Tier | null {
  if (!value) return null;
  for (const word of value.toLowerCase().split(/[^a-zа-яё]+/)) {
    const tier = TIER_WORDS.get(word);
    if (tier) return tier;
  }
  return null;
}

function invoiceLines(invoice: Rec): Rec[] {
  const data = rec(invoice.lines)?.data;
  if (!Array.isArray(data)) return [];
  return data.flatMap((line) => {
    const item = rec(line);
    return item ? [item] : [];
  });
}

/** Главная строка счёта. При смене тарифа первой идёт возврат за старый
 *  (минус); нужна первая со знаком плюс — это и есть новый тариф. */
function mainLine(lines: Rec[]): Rec | null {
  return lines.find((line) => (num(line.amount) ?? 0) > 0) ?? lines[0] ?? null;
}

/** Тариф счёта: метки цены и подписки (их ставит `tariff-checkout`), затем
 *  `lookup_key`, затем слова названия цены и описания строки. */
function tierOfInvoice(invoice: Rec, line: Rec | null): Tier | null {
  const price = rec(line?.price);
  const details = rec(invoice.subscription_details) ?? rec(rec(invoice.parent)?.subscription_details);
  for (const meta of [price?.metadata, line?.metadata, details?.metadata]) {
    const tier = asTier(rec(meta)?.tier);
    if (tier) return tier;
  }
  const lookup = /^babun_(solo|pro|max)_/.exec(text(price?.lookup_key) ?? "");
  return asTier(lookup?.[1]) ?? tierInWords(text(price?.nickname)) ?? tierInWords(text(line?.description));
}

/** Событие Stripe → строка оплаты; `null` — не оплата или читать нечего. */
export function parsePayment(row: BillingEventRow): TariffPayment | null {
  const failed = row.event_type === "invoice.payment_failed";
  if (!failed && row.event_type !== "invoice.payment_succeeded") return null;

  const event = rec(row.payload);
  const invoice = rec(rec(event?.data)?.object);
  if (!invoice) return null;

  const cents = failed
    ? (num(invoice.amount_due) ?? num(invoice.total))
    : (num(invoice.amount_paid) ?? num(invoice.total) ?? num(invoice.amount_due));
  if (cents !== null && cents <= 0) return null;

  // Оплаченный счёт — по часам оплаты; у неудачного их нет, и берутся часы
  // самого события (создан счёт был задолго до попытки).
  const processed = row.processed_at ? Date.parse(row.processed_at) : Number.NaN;
  const at =
    unixMs(rec(invoice.status_transitions)?.paid_at) ??
    unixMs(event?.created) ??
    (Number.isFinite(processed) ? processed : null) ??
    unixMs(invoice.created);
  if (at === null) return null;

  const line = mainLine(invoiceLines(invoice));
  const period = rec(line?.period);
  const start = unixMs(period?.start);
  const end = unixMs(period?.end);
  const hasPeriod = start !== null && end !== null && end >= start;

  const tier = tierOfInvoice(invoice, line);
  return {
    id: row.id,
    invoiceId: text(invoice.id),
    failed,
    amount: cents === null ? null : cents / 100,
    currency: (text(invoice.currency) ?? "eur").toUpperCase(),
    at,
    tier,
    title: tier ? tierName(tier) : (text(line?.description) ?? "Оплата тарифа"),
    periodStart: hasPeriod ? start : null,
    periodEnd: hasPeriod ? end : null,
    url: httpsUrl(invoice.hosted_invoice_url) ?? httpsUrl(invoice.invoice_pdf),
  };
}

/** Повторы неудачной оплаты одного счёта — одна строка (самая свежая). На
 *  входе — от новых к старым. */
export function collapseRetries(payments: readonly TariffPayment[]): TariffPayment[] {
  const seen = new Set<string>();
  return payments.filter((payment) => {
    if (!payment.failed || !payment.invoiceId) return true;
    if (seen.has(payment.invoiceId)) return false;
    seen.add(payment.invoiceId);
    return true;
  });
}

/** Лента оплат из строк `billing_events`: разобранные, свежие сверху. */
export function buildPayments(rows: readonly BillingEventRow[]): TariffPayment[] {
  const parsed: TariffPayment[] = [];
  for (const row of rows) {
    const payment = parsePayment(row);
    if (payment) parsed.push(payment);
  }
  parsed.sort((a, b) => b.at - a.at);
  return collapseRetries(parsed);
}

const MONTHS_SHORT = [
  "янв",
  "фев",
  "мар",
  "апр",
  "мая",
  "июн",
  "июл",
  "авг",
  "сен",
  "окт",
  "ноя",
  "дек",
] as const;

const MONTH_TITLES = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
] as const;

/** «3 окт»; год дописывается, только если он не текущий. Часы телефона —
 *  так же, как у остальных дат Кабинета (`when.ts`). */
export function shortDate(ms: number, now: number): string {
  const d = new Date(ms);
  const year = d.getFullYear() === new Date(now).getFullYear() ? "" : ` ${d.getFullYear()}`;
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}${year}`;
}

/** «3 окт – 3 ноя»; начало и конец в один день — одной датой. */
export function periodWords(start: number, end: number, now: number): string {
  const from = shortDate(start, now);
  const to = shortDate(end, now);
  return from === to ? from : `${from} – ${to}`;
}

export interface PaymentMonth {
  /** «2026-10» — местный месяц телефона. */
  key: string;
  /** «Октябрь 2026». */
  title: string;
  payments: TariffPayment[];
}

/** Оплаты по месяцам. На входе — от новых к старым, на выходе тот же порядок. */
export function groupByMonth(payments: readonly TariffPayment[]): PaymentMonth[] {
  const months: PaymentMonth[] = [];
  for (const payment of payments) {
    const d = new Date(payment.at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const last = months[months.length - 1];
    if (last && last.key === key) {
      last.payments.push(payment);
    } else {
      months.push({ key, title: `${MONTH_TITLES[d.getMonth()]} ${d.getFullYear()}`, payments: [payment] });
    }
  }
  return months;
}

/** Подпись строки: срок оплаты («3 окт – 3 ноя»), без срока — день оплаты;
 *  неудачной дописывается «· не прошла». */
export function paymentSub(payment: TariffPayment, now: number): string {
  const when =
    payment.periodStart !== null && payment.periodEnd !== null
      ? periodWords(payment.periodStart, payment.periodEnd, now)
      : shortDate(payment.at, now);
  return payment.failed ? `${when} · не прошла` : when;
}

/** Сумма справа: «€29,99»; нет суммы — нет и числа. */
export function paymentValue(payment: TariffPayment): string | undefined {
  return payment.amount === null ? undefined : money(payment.amount, payment.currency);
}

/** Подпись двери в Кабинете: «Последняя — €29,99 · 3 окт»; последняя
 *  неудачная — «Не прошла — …»; оплат не было — так и сказано. */
export function latestPaymentLine(payment: TariffPayment | null, now: number): string {
  if (!payment) return "Оплат пока не было";
  const facts = [paymentValue(payment), shortDate(payment.at, now)].filter(Boolean).join(" · ");
  return `${payment.failed ? "Не прошла" : "Последняя"} — ${facts}`;
}
