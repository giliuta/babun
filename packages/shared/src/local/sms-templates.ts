// SMS templates with variable tokens.
//
// P2 #41 (CRM Core brief) — palette and stored format moved from
// English ([Name]) to Russian ([Имя]) because the UI surface is
// Russian and «вставить [Name]» felt foreign to the operator.
// Legacy templates that already contain [Name]/[Date]/etc. keep
// working: TOKEN_ALIASES maps Russian → English so renderTemplate
// resolves both forms against the same context dictionary, and the
// regex uses \p{L} (Unicode-aware) to match Cyrillic identifiers.
//
// New Russian-only tokens added per brief:
//   [Цена]              — sum due (e.g. «€80»)
//   [Компания]          — tenant brand name
//   [СсылкаНаОтмену]    — short URL to the public cancel page

import { generateId } from "./masters";

export type TemplateKind =
  | "new_appointment"
  | "reminder"
  | "after_24h_short"
  | "after_24h_long"
  | "cancellation"
  | "waitlist"
  | "debt";

export interface SmsTemplate {
  id: string;
  kind: TemplateKind;
  name: string;
  body: string;
  enabled: boolean;
}

export const KIND_LABELS: Record<TemplateKind, string> = {
  new_appointment: "Новая запись",
  reminder: "Напоминание о записи",
  after_24h_short: "После записи (в течение 24 ч.)",
  after_24h_long: "После записи (после 24 ч.)",
  cancellation: "После отмены записи",
  waitlist: "Для листа ожидания",
  debt: "Напоминание о долге",
};

export const AVAILABLE_TOKENS = [
  { token: "[Имя]", label: "Имя клиента" },
  { token: "[День]", label: "День недели" },
  { token: "[Дата]", label: "Дата" },
  { token: "[Время]", label: "Время" },
  { token: "[Мастер]", label: "Мастер" },
  { token: "[Услуга]", label: "Услуга" },
  { token: "[Адрес]", label: "Адрес" },
  { token: "[Цена]", label: "Цена" },
  { token: "[Сумма]", label: "Сумма долга" },
  { token: "[Компания]", label: "Компания" },
  { token: "[СсылкаНаОтмену]", label: "Ссылка на отмену" },
] as const;

// Russian → canonical English keys used by the context dictionary
// passed to renderTemplate. Lets legacy [Name] AND new [Имя] resolve
// to the same value without duplicating the substitution map.
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

// Дефолтного текста у шаблонов нет и быть не может: раньше здесь лежал сид
// с подписью «AirFix» — текст одного клиента, — и он утекал каждому новому
// тенанту при регистрации. Babun продаётся многим компаниям, поэтому шаблон
// заводит сам тенант — этой функцией, с пустым телом.
export function createBlankTemplate(kind: TemplateKind = "new_appointment"): SmsTemplate {
  return {
    id: generateId("tpl"),
    kind,
    name: KIND_LABELS[kind],
    body: "",
    enabled: true,
  };
}

// Render a template by substituting tokens. Accepts both English
// ([Name]) and Russian ([Имя]) forms in the same body — the alias
// table maps Russian keys to their canonical English counterparts so
// `vars` only has to be keyed once. Unicode-aware regex (\p{L} + /u)
// is required to match Cyrillic identifiers; the default \w is ASCII
// only and would silently skip [Имя] etc.
export function renderTemplate(
  body: string,
  vars: Partial<Record<string, string>>
): string {
  return body.replace(/\[([\p{L}\p{N}_]+)\]/gu, (match, key) => {
    const canonical = TOKEN_ALIASES[key] ?? key;
    return vars[canonical] ?? vars[key] ?? match;
  });
}
