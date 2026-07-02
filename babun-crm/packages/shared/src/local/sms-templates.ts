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

const NOW = new Date().toISOString();

// STORY-053a — empty array. Previously defaulted to AirFix-flavoured
// templates with a literal "AirFix" signature in every body. Leaked
// into every fresh tenant on first signup. New tenants now start
// with no templates and use the existing Settings → SMS templates
// editor (or STORY-047 SMS reminders) to add their own.
export const DEFAULT_TEMPLATES: SmsTemplate[] = [];

const STORAGE_KEY = "babun-sms-templates";

export function loadTemplates(): SmsTemplate[] {
  if (typeof window === "undefined") return DEFAULT_TEMPLATES;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    // v662 — DATA-LOSS GUARD: respect explicit `[]`. The user might
    // have intentionally deleted every template; don't silently
    // revive defaults.
    if (raw === null) return DEFAULT_TEMPLATES;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : DEFAULT_TEMPLATES;
  } catch {
    return DEFAULT_TEMPLATES;
  }
}

export function saveTemplates(list: SmsTemplate[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // ignore
  }
}

export function createBlankTemplate(kind: TemplateKind = "new_appointment"): SmsTemplate {
  return {
    id: generateId("tpl"),
    kind,
    name: KIND_LABELS[kind],
    body: "",
    enabled: true,
  };
}

void NOW;

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
