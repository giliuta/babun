// ТЕКСТ SMS НА СЕРВЕРЕ — ТЕМИ ЖЕ ПРАВИЛАМИ, ЧТО В ПРИЛОЖЕНИИ (STORY-089).
//
// Шаблон один на продукт — `[Имя]`, и клиент обязан получить через сервис
// ровно тот текст, какой владелец видит в листе «SMS» у номера. Функция на
// сервере не может импортировать `packages/shared` (другой рантайм, другой
// сборщик), поэтому правила здесь — копия `apps/mobile/src/features/sms/
// sms-compose.ts`, а сверку держит тест приложения
// `server-render-parity.test.ts`: одни и те же записи обязаны давать один и
// тот же текст. Модуль чистый — ни Deno, ни сети — поэтому его читает и Bun.
//
// Правило то же: шаблон, у которого хоть одно поле пусто, НЕ отправляется
// (null) — клиент не получит «ждём вас  в ».

export interface SmsRenderVars {
  name?: string | null;
  date?: string | null;
  time?: string | null;
  calendar?: string | null;
  services?: readonly (string | null | undefined)[] | null;
  address?: string | null;
  total?: number | string | null;
  debt?: number | string | null;
  company?: string | null;
  currency?: string | null;
}

const WEEKDAYS = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
const MONTHS = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

const TOKEN_ALIASES: Record<string, string> = {
  Имя: "Name",
  День: "Day",
  Дата: "Date",
  Время: "Time",
  Мастер: "Master",
  Услуга: "Service",
  Адрес: "Address",
  Цена: "Price",
  Сумма: "Amount",
  Компания: "Company",
  СсылкаНаОтмену: "CancelUrl",
};

/** Символы ходовых валют — как в `packages/shared/src/common/utils/currencies`.
 *  Незнакомый код печатается как есть, через неразрывный пробел. */
const SYMBOLS: Record<string, string> = {
  EUR: "€",
  USD: "$",
  GBP: "£",
  UAH: "₴",
  RUB: "₽",
};

const NB = " ";

export function formatMoney(value: number, currency?: string | null): string {
  const code = (currency ?? "").trim().toUpperCase();
  const symbol = code ? (SYMBOLS[code] ?? code) : "€";
  const prefix = symbol.length > 1 ? `${symbol}${NB}` : symbol;
  const cents = Math.round(value * 100);
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, NB);
  const fraction = abs % 100;
  const body = `${prefix}${whole}${fraction ? `,${String(fraction).padStart(2, "0")}` : ""}`;
  return cents < 0 ? `−${body}` : body;
}

const clean = (value: string | null | undefined): string | undefined => {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text ? text : undefined;
};

function positiveMoney(value: number | string | null | undefined, currency?: string | null): string | undefined {
  const n = typeof value === "string" ? Number(value) : value;
  if (n == null || !Number.isFinite(n) || Math.round(n * 100) <= 0) return undefined;
  return formatMoney(n, currency);
}

export function renderVars(v: SmsRenderVars): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (key: string, value: string | undefined) => {
    if (value) out[key] = value;
  };
  put("Name", clean(v.name));
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v.date ?? "");
  if (m) {
    const day = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    if (!Number.isNaN(day.getTime())) {
      put("Day", WEEKDAYS[day.getUTCDay()]);
      put("Date", `${day.getUTCDate()} ${MONTHS[day.getUTCMonth()]}`);
    }
  }
  const t = /^(\d{1,2}):(\d{2})/.exec(v.time ?? "");
  if (t) put("Time", `${t[1].padStart(2, "0")}:${t[2]}`);
  put("Master", clean(v.calendar));
  const services = (v.services ?? []).map(clean).filter((s): s is string => !!s);
  put("Service", services.length ? [...new Set(services)].join(", ") : undefined);
  put("Address", clean(v.address));
  put("Price", positiveMoney(v.total, v.currency));
  put("Amount", positiveMoney(v.debt, v.currency));
  put("Company", clean(v.company));
  return out;
}

/** Текст шаблона, если заполняется целиком; иначе null. */
export function renderSms(template: string | null | undefined, v: SmsRenderVars): string | null {
  const body = template ?? "";
  if (!body.trim()) return null;
  const vars = renderVars(v);
  let missing = false;
  const text = body.replace(/\[([\p{L}\p{N}_]+)\]/gu, (match, key: string) => {
    const value = vars[TOKEN_ALIASES[key] ?? key];
    if (!value) {
      missing = true;
      return match;
    }
    return value;
  });
  if (missing) return null;
  return text.replace(/[ \t]{2,}/g, " ").trim();
}
