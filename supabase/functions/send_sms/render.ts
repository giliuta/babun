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
  /** Ссылка «Подтвердить / Отменить» — `sms_claim` кладёт её, только если
   *  текст просит [Ссылка]. */
  link?: string | null;
}

// День и дата — на языке шаблона: английский шаблон не получает «пятница».
// Языка у шаблона в базе нет — он читается из текста (`smsLanguageOf`).
export type SmsLanguage = "ru" | "en" | "bg" | "el" | "uk" | "de" | "es";

const WEEKDAYS: Record<SmsLanguage, readonly string[]> = {
  ru: ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"],
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  bg: ["неделя", "понеделник", "вторник", "сряда", "четвъртък", "петък", "събота"],
  el: ["Κυριακή", "Δευτέρα", "Τρίτη", "Τετάρτη", "Πέμπτη", "Παρασκευή", "Σάββατο"],
  uk: ["неділя", "понеділок", "вівторок", "середа", "четвер", "п'ятниця", "субота"],
  de: ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"],
  es: ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"],
};

const MONTHS: Record<SmsLanguage, readonly string[]> = {
  ru: ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"],
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  bg: ["януари", "февруари", "март", "април", "май", "юни", "юли", "август", "септември", "октомври", "ноември", "декември"],
  el: ["Ιανουαρίου", "Φεβρουαρίου", "Μαρτίου", "Απριλίου", "Μαΐου", "Ιουνίου", "Ιουλίου", "Αυγούστου", "Σεπτεμβρίου", "Οκτωβρίου", "Νοεμβρίου", "Δεκεμβρίου"],
  uk: ["січня", "лютого", "березня", "квітня", "травня", "червня", "липня", "серпня", "вересня", "жовтня", "листопада", "грудня"],
  de: ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"],
  es: ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"],
};

function dateWords(day: number, month: number, lang: SmsLanguage): string {
  const name = MONTHS[lang][month];
  if (lang === "de") return `${day}. ${name}`;
  if (lang === "es") return `${day} de ${name}`;
  return `${day} ${name}`;
}

const BULGARIAN_WORDS = /(^|[^а-яё])(ще|във|със|сте|утре|днес|здравейте|напомняме|очакваме|благодарим ви)(?=$|[^а-яё])/i;
/** Немецкий и испанский без умлаутов и ударений латиницей не отличить от
 *  английского — тоже по ходовым словам, которых в английском нет. */
const GERMAN_WORDS = /\b(wir|sie|ihr|ihre|ihren|ihrem|und|uhr|termin|morgen|hallo|danke|bitte|ist|bis|zum)\b/i;
const SPANISH_WORDS = /\b(hola|gracias|cita|te|le|el|los|las|su|sus|para|por|con|del|esperamos|nos|vemos)\b/i;

/** Язык шаблона по его тексту без полей `[…]`; нечего прочесть — русский. */
export function smsLanguageOf(body: string | null | undefined): SmsLanguage {
  const text = (body ?? "").replace(/\[[\p{L}\p{N}_]+\]/gu, " ");
  if (/[Ά-ώ]/.test(text)) return "el";
  if (/[а-яёіїєґ]/i.test(text)) {
    if (/[іїєґ]/i.test(text)) return "uk";
    if (/[ыэё]/i.test(text)) return "ru";
    return BULGARIAN_WORDS.test(text) ? "bg" : "ru";
  }
  if (/[a-z]/i.test(text)) {
    if (/[äöüß]/i.test(text) || GERMAN_WORDS.test(text)) return "de";
    if (/[ñ¡¿áéíóú]/i.test(text) || SPANISH_WORDS.test(text)) return "es";
    return "en";
  }
  return "ru";
}

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
  Ссылка: "Link",
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

const NB = "\u00a0";

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

export function renderVars(v: SmsRenderVars, lang: SmsLanguage = "ru"): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (key: string, value: string | undefined) => {
    if (value) out[key] = value;
  };
  put("Name", clean(v.name));
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v.date ?? "");
  if (m) {
    const day = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    if (!Number.isNaN(day.getTime())) {
      put("Day", WEEKDAYS[lang][day.getUTCDay()]);
      put("Date", dateWords(day.getUTCDate(), day.getUTCMonth(), lang));
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
  put("Link", clean(v.link));
  return out;
}

/** Текст шаблона, если заполняется целиком; иначе null. */
export function renderSms(template: string | null | undefined, v: SmsRenderVars): string | null {
  const body = template ?? "";
  if (!body.trim()) return null;
  const vars = renderVars(v, smsLanguageOf(body));
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
