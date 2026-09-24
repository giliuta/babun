import { money } from "@babun/shared/common/utils/money";
import {
  renderTemplate,
  templateTokenKeys,
  type SmsTemplate,
} from "@babun/shared/local/sms-templates";

// SMS ПО ШАБЛОНУ СО СВОЕГО ТЕЛЕФОНА (STORY-089, волна 1).
//
// Владелец 24.09: «чтоб можно было по шаблону отправлять со своего личного
// телефона». Кнопка «SMS» у номера открывает шаблоны компании, подставляет в
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
  | "CancelUrl";

const WEEKDAYS = [
  "воскресенье",
  "понедельник",
  "вторник",
  "среда",
  "четверг",
  "пятница",
  "суббота",
] as const;

const MONTHS_GENITIVE = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
] as const;

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
    put("Day", WEEKDAYS[day.getUTCDay()]);
    put("Date", `${day.getUTCDate()} ${MONTHS_GENITIVE[day.getUTCMonth()]}`);
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
  return vars;
}

/** Текст шаблона, если заполняется целиком; иначе `null`. Пустой шаблон —
 *  тоже `null`: отправлять нечего. */
export function fillTemplate(body: string, vars: SmsVars): string | null {
  if (!body.trim()) return null;
  const keys = templateTokenKeys(body);
  if (keys.some((key) => !vars[key as SmsVarKey])) return null;
  return renderTemplate(body, vars).replace(/[ \t]{2,}/g, " ").trim();
}

export interface SmsOption {
  template: SmsTemplate;
  text: string;
}

/** Шаблоны, готовые к отправке: включённые и заполняемые целиком, в порядке
 *  списка компании. */
export function smsOptions(templates: readonly SmsTemplate[], vars: SmsVars): SmsOption[] {
  const out: SmsOption[] = [];
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
