import { money } from "@babun/shared/common/utils/money";
import { renderTemplate, templateTokenKeys } from "@babun/shared/local/sms-templates";
import { analyzeSmsEncoding, MAX_SMS_PARTS, stripEmoji } from "@babun/shared/local/sms-encoding";

// SMS ПО ШАБЛОНУ СО СВОЕГО ТЕЛЕФОНА. Кнопка «SMS» у номера открывает шаблоны компании, подставляет в
// них запись и клиента и открывает «Сообщения» с готовым текстом —
// отправляет человек сам.
//
// ПОКАЗЫВАЕТСЯ ТОЛЬКО ТО, ЧТО ЗАПОЛНЯЕТСЯ ЦЕЛИКОМ. Шаблон «ждём вас [Дата] в
// [Время]» из карточки клиента без записи превратился бы в «ждём вас  в » —
// клиенту так писать нельзя, а исправлять черновик в «Сообщениях» — лишний
// этап. Поэтому шаблон, у которого хоть одно поле пусто, в списке просто не
// стоит. Модуль чистый: ни React, ни платформы — только текст.

/** Значения полей по каноническим (английским) именам токенов. */
export type SmsVars = Partial<Record<SmsVarKey, string>>;

export type SmsVarKey =
  | "Name"
  | "Day"
  | "Date"
  | "Time"
  | "Master"
  | "Service"
  | "Address"
  | "Price"
  | "Amount"
  | "Company"
  | "CancelUrl"
  | "Link";

// ДЕНЬ И ДАТА — НА ЯЗЫКЕ ШАБЛОНА. Владелец пишет шаблон тем языком, каким
// говорит с клиентом: в английский шаблон «see you on [Day]» русское
// «пятница» вставлять нельзя. Языка у шаблона в базе нет, поэтому он
// читается из самого текста (`smsLanguageOf`). Таблицы — данные SMS, а не
// интерфейс: файл в `i18n/ignore.json`, перевод при сборке их не трогает.
// Копия правила у сервера — `supabase/functions/send_sms/render.ts`, сверку
// держит `server-render-parity.test.ts`.

export type SmsLanguage = "ru" | "en" | "bg" | "el" | "uk" | "de" | "es";

/** Дни недели с воскресенья, как их пишут внутри фразы. */
const WEEKDAYS: Record<SmsLanguage, readonly string[]> = {
  ru: ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"],
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  bg: ["неделя", "понеделник", "вторник", "сряда", "четвъртък", "петък", "събота"],
  el: ["Κυριακή", "Δευτέρα", "Τρίτη", "Τετάρτη", "Πέμπτη", "Παρασκευή", "Σάββατο"],
  uk: ["неділя", "понеділок", "вівторок", "середа", "четвер", "п'ятниця", "субота"],
  de: ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"],
  es: ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"],
};

/** Месяцы в той форме, что стоит после числа: «24 сентября», «24 Σεπτεμβρίου». */
const MONTHS: Record<SmsLanguage, readonly string[]> = {
  ru: ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"],
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  bg: ["януари", "февруари", "март", "април", "май", "юни", "юли", "август", "септември", "октомври", "ноември", "декември"],
  el: ["Ιανουαρίου", "Φεβρουαρίου", "Μαρτίου", "Απριλίου", "Μαΐου", "Ιουνίου", "Ιουλίου", "Αυγούστου", "Σεπτεμβρίου", "Οκτωβρίου", "Νοεμβρίου", "Δεκεμβρίου"],
  uk: ["січня", "лютого", "березня", "квітня", "травня", "червня", "липня", "серпня", "вересня", "жовтня", "листопада", "грудня"],
  de: ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"],
  es: ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"],
};

/** «24 сентября», «24 September», «24. September», «24 de septiembre». */
function dateWords(day: number, month: number, lang: SmsLanguage): string {
  const name = MONTHS[lang][month];
  if (lang === "de") return `${day}. ${name}`;
  if (lang === "es") return `${day} de ${name}`;
  return `${day} ${name}`;
}

/** Болгарский от русского по буквам не отличить — по ходовым словам SMS. */
const BULGARIAN_WORDS = /(^|[^а-яё])(ще|във|със|сте|утре|днес|здравейте|напомняме|очакваме|благодарим ви)(?=$|[^а-яё])/i;
/** Немецкий и испанский без умлаутов и ударений латиницей не отличить от
 *  английского — тоже по ходовым словам, которых в английском нет. */
const GERMAN_WORDS = /\b(wir|sie|ihr|ihre|ihren|ihrem|und|uhr|termin|morgen|hallo|danke|bitte|ist|bis|zum)\b/i;
const SPANISH_WORDS = /\b(hola|gracias|cita|te|le|el|los|las|su|sus|para|por|con|del|esperamos|nos|vemos)\b/i;

/** Язык шаблона по его собственному тексту (поля `[…]` не в счёт — в них
 *  имена и адреса на любом языке). Нечего прочесть — русский, как раньше. */
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

/** [День] и [Дата] на языке шаблона. Поля собираются раньше, чем известен
 *  шаблон (`smsVars` — один словарь на все шаблоны листа), и пишут их
 *  по-русски; шаблон на другом языке получает те же день и дату своими
 *  словами. */
function localizeDate(vars: SmsVars, lang: SmsLanguage): SmsVars {
  if (lang === "ru") return vars;
  const out: SmsVars = { ...vars };
  const weekday = vars.Day ? WEEKDAYS.ru.indexOf(vars.Day) : -1;
  if (weekday >= 0) out.Day = WEEKDAYS[lang][weekday];
  const date = /^(\d{1,2}) (\S+)$/.exec(vars.Date ?? "");
  const month = date ? MONTHS.ru.indexOf(date[2]) : -1;
  if (date && month >= 0) out.Date = dateWords(Number(date[1]), month, lang);
  return out;
}

export interface SmsSource {
  /** [Имя] — «Обращение» клиента или его первое имя (`addressedAs`). */
  name?: string | null;
  /** Дата записи «YYYY-MM-DD» → [День] и [Дата]. */
  date?: string | null;
  /** Начало записи «HH:MM» или «HH:MM:SS» → [Время]. */
  time?: string | null;
  /** [Мастер] — календарь записи: клиент знает бригаду по её имени. */
  calendar?: string | null;
  /** [Услуга] — названия услуг записи. */
  services?: readonly (string | null | undefined)[];
  /** [Адрес] — адрес выезда. */
  address?: string | null;
  /** [Цена] — итог записи; ноль и пусто — цены нет. */
  total?: number | null;
  /** [Сумма] — долг клиента; ноль и пусто — долга нет. */
  debt?: number | null;
  /** [Компания] — имя компании. */
  company?: string | null;
  /** Валюта для [Цена] и [Сумма]; по умолчанию — валюта компании. */
  currency?: string;
  /** [Ссылка] — «Подтвердить / Отменить», babun.app/r/…; есть только у
   *  записи, и только когда текст её просит. */
  link?: string | null;
}

const clean = (value: string | null | undefined): string | undefined => {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text ? text : undefined;
};

function parseYmd(ymd: string | null | undefined): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd ?? "");
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

function positiveMoney(value: number | null | undefined, currency?: string): string | undefined {
  if (value == null || !Number.isFinite(value) || Math.round(value * 100) <= 0) return undefined;
  return currency ? money(value, currency) : money(value);
}

/** Поля шаблона из записи и клиента. Пустое поле не попадает в словарь —
 *  так шаблон с ним не считается заполняемым. */
export function smsVars(source: SmsSource): SmsVars {
  const vars: SmsVars = {};
  const put = (key: SmsVarKey, value: string | undefined) => {
    if (value) vars[key] = value;
  };
  put("Name", clean(source.name));
  const day = parseYmd(source.date);
  if (day) {
    put("Day", WEEKDAYS.ru[day.getUTCDay()]);
    put("Date", dateWords(day.getUTCDate(), day.getUTCMonth(), "ru"));
  }
  const time = /^(\d{1,2}):(\d{2})/.exec(source.time ?? "");
  if (time) put("Time", `${time[1].padStart(2, "0")}:${time[2]}`);
  put("Master", clean(source.calendar));
  const services = (source.services ?? []).map(clean).filter((s): s is string => !!s);
  put("Service", services.length ? [...new Set(services)].join(", ") : undefined);
  put("Address", clean(source.address));
  put("Price", positiveMoney(source.total, source.currency));
  put("Amount", positiveMoney(source.debt, source.currency));
  put("Company", clean(source.company));
  put("Link", clean(source.link));
  return vars;
}

/** Текст шаблона, если заполняется целиком; иначе `null`. Пустой шаблон —
 *  тоже `null`: отправлять нечего. День и дата — на языке шаблона. */
export function fillTemplate(body: string, vars: SmsVars): string | null {
  if (!body.trim()) return null;
  const keys = templateTokenKeys(body);
  if (keys.some((key) => !vars[key as SmsVarKey])) return null;
  return renderTemplate(body, localizeDate(vars, smsLanguageOf(body))).replace(/[ \t]{2,}/g, " ").trim();
}

/** Что нужно от шаблона листу: шаблон команды (`sms_team_templates`) и
 *  прежний шаблон компании отвечают одинаково. */
export interface SmsTemplateLike {
  id: string;
  name: string;
  body: string;
  enabled: boolean;
}

export interface SmsOption<T extends SmsTemplateLike = SmsTemplateLike> {
  template: T;
  text: string;
}

/** Шаблоны, готовые к отправке: включённые и заполняемые целиком, в порядке
 *  списка. */
export function smsOptions<T extends SmsTemplateLike>(templates: readonly T[], vars: SmsVars): SmsOption<T>[] {
  const out: SmsOption<T>[] = [];
  for (const template of templates) {
    if (!template.enabled) continue;
    const text = fillTemplate(template.body, vars);
    if (text) out.push({ template, text });
  }
  return out;
}

/** Ссылка `sms:` с текстом. Разделитель — свойство платформы: iOS ждёт
 *  «&body=», Android — «?body=». Пустой текст — ссылка без текста. */
export function smsUrlWithBody(url: string, body: string, os: string): string {
  if (!body) return url;
  return `${url}${os === "ios" ? "&" : "?"}body=${encodeURIComponent(body)}`;
}

// ЛИМИТ СООБЩЕНИЯ И БЕЗ ЭМОДЗИ (эмодзи не используем, тариф — просто лимиты по
// сообщению). Тариф понятен
// тремя строками: до 70 знаков — 1 SMS, до 134 — 2, до 201 — 3; длиннее
// набрать нельзя. Эмодзи в поле не попадают вовсе.

// Само правило — в общем счёте частей (`sms-encoding`): его копию у сервера
// (`send_sms/encoding.ts`) держит тот же тест сверки, и сервер отказывает
// тексту длиннее трёх SMS, ничего не списав.
export { MAX_SMS_PARTS, stripEmoji };

/** Сколько SMS займёт текст (как считает Twilio). */
export const smsPartsOf = (text: string): number => analyzeSmsEncoding(text).segments;

/** Можно ли отправить текст: не пустой и не длиннее 3 SMS. Поле пускает
 *  стирание сверх предела, и шаблон с длинными полями встаёт в него целиком —
 *  такой текст кнопка отправки не берёт (сервер его всё равно отклонит, а
 *  «Сообщения» телефона ушлют любой длины). */
export const fitsSmsLimit = (text: string): boolean =>
  !!text.trim() && smsPartsOf(text) <= MAX_SMS_PARTS;

/** Правка поля SMS: без эмодзи, а сверх лимита — остаётся прежний текст.
 *  `measure` — текст, по которому считать части (у шаблона — с подставленными
 *  полями). */
export function acceptSmsInput(next: string, prev: string, measure: (text: string) => string = (x) => x): string {
  const clean = stripEmoji(next);
  return smsPartsOf(measure(clean)) > MAX_SMS_PARTS && clean.length > prev.length ? prev : clean;
}
