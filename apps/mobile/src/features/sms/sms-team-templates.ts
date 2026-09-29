import { formatCountRu } from "@babun/shared/common/utils/plural-ru";
import { templateTokenKeys } from "@babun/shared/local/sms-templates";

// ШАБЛОНЫ SMS КОМАНДЫ — ФОРМА ДАННЫХ И ПРАВИЛА (STORY-089, 29.09). Чистый
// модуль: разбор ответа базы, слова «когда», черновик настройки и его
// проверка. Без React и сети — его читают тесты.
//
// Владелец 29.09: «каждой команде свой шаблон… когда добавляю шаблон,
// полноценно настраиваю: когда отправлять — за 24 часа или в такое-то
// время… тихих часов такого понятия нет, мы программируем шаблон в
// определённое время… главное — удобно, чтоб не было косяков». Поэтому:
//   • «когда» — у шаблона, восемь вариантов, у каждого свой срок;
//   • у автоматического шаблона — окно «можно отправлять с … до …» (часы
//     календаря); «накануне в ЧЧ:ММ» уходит ровно в своё время, окна у него
//     нет; ручному окно не нужно;
//   • проверка черновика здесь же — та же, что у базы: сохранить нельзя то,
//     что база отвергнет.

export const SMS_WHEN = [
  "manual",
  "created",
  "before",
  "day_before",
  "rescheduled",
  "cancelled",
  "after",
  "repeat",
] as const;

export type SmsWhen = (typeof SMS_WHEN)[number];

export interface SmsTeamTemplate {
  id: string;
  teamId: string;
  name: string;
  body: string;
  trigger: SmsWhen;
  /** «До визита» — часы до начала; «После визита» — часы после конца. */
  hours: number | null;
  /** «Накануне» — «ЧЧ:ММ» по времени календаря. */
  atTime: string | null;
  /** «Пора повторить» — месяцы после визита. */
  months: number | null;
  /** Окно отправки, часы календаря: с `sendFrom` до `sendTo`. */
  sendFrom: number;
  sendTo: number;
  enabled: boolean;
  position: number;
}

type Raw = Record<string, unknown>;

const isWhen = (v: unknown): v is SmsWhen => SMS_WHEN.includes(v as SmsWhen);
const int = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) ? v : null);

export function parseTeamTemplate(raw: unknown): SmsTeamTemplate | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Raw;
  if (typeof r.id !== "string" || typeof r.team_id !== "string" || typeof r.body !== "string") return null;
  return {
    id: r.id,
    teamId: r.team_id,
    name: typeof r.name === "string" && r.name ? r.name : "Шаблон",
    body: r.body,
    trigger: isWhen(r.trigger) ? r.trigger : "manual",
    hours: int(r.hours),
    atTime: typeof r.at_time === "string" && r.at_time ? r.at_time : null,
    months: int(r.months),
    sendFrom: int(r.send_from) ?? 8,
    sendTo: int(r.send_to) ?? 21,
    enabled: r.enabled !== false,
    position: int(r.position) ?? 0,
  };
}

export function parseTeamTemplates(rows: unknown): SmsTeamTemplate[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(parseTeamTemplate).filter((x): x is SmsTeamTemplate => x !== null);
}

/** Варианты «Когда отправлять» — в том порядке, в каком их видит владелец. */
export const WHEN_LABELS: Record<SmsWhen, string> = {
  manual: "Вручную",
  created: "После записи",
  before: "До визита",
  day_before: "Накануне",
  rescheduled: "При переносе",
  cancelled: "При отмене",
  after: "После визита",
  repeat: "Пора повторить",
};

const hoursCount = (h: number) => formatCountRu(h, ["час", "часа", "часов"]);

function hoursSpan(h: number): string {
  if (h === 24) return "сутки";
  if (h % 24 === 0) return formatCountRu(h / 24, ["день", "дня", "дней"]);
  return hoursCount(h);
}

/** Одна строка «когда»: подпись строки шаблона. */
export function whenWords(t: Pick<SmsTeamTemplate, "trigger" | "hours" | "atTime" | "months">): string {
  switch (t.trigger) {
    case "manual":
      return "Только вручную";
    case "created":
      return "Сразу после записи";
    case "before":
      return t.hours ? `За ${hoursSpan(t.hours)} до визита` : "До визита";
    case "day_before":
      return t.atTime ? `Накануне в ${t.atTime}` : "Накануне";
    case "rescheduled":
      return "При переносе записи";
    case "cancelled":
      return "При отмене записи";
    case "after":
      return t.hours ? `Через ${hoursSpan(t.hours)} после визита` : "После визита";
    case "repeat":
      return t.months ? `Через ${formatCountRu(t.months, ["месяц", "месяца", "месяцев"])} после визита` : "Пора повторить";
  }
}

const hh = (hour: number): string => `${String(hour).padStart(2, "0")}:00`;

/** «с 08:00 до 21:00»; весь день — «Круглосуточно». */
export function windowWords(from: number, to: number): string {
  if (from <= 0 && to >= 24) return "Круглосуточно";
  return `с ${hh(from)} до ${to >= 24 ? "24:00" : hh(to)}`;
}

/** Действует ли окно отправки: ручному и «накануне в ЧЧ:ММ» — нет. */
export const usesWindow = (trigger: SmsWhen): boolean => trigger !== "manual" && trigger !== "day_before";

/** Сроки на выбор — видны сразу, ставятся одним тапом. */
export const HOURS_BEFORE = [1, 2, 3, 6, 12, 24, 48, 72] as const;
export const HOURS_AFTER = [1, 2, 3, 6, 24, 48] as const;
export const DAY_BEFORE_TIMES = ["09:00", "12:00", "15:00", "17:00", "18:00", "19:00", "20:00"] as const;
export const REPEAT_MONTHS = [1, 3, 6, 9, 12] as const;
export const WINDOW_FROM = [7, 8, 9, 10] as const;
export const WINDOW_TO = [20, 21, 22, 24] as const;

/** Короткая подпись фишки срока: «24 ч», «2 дня», «6 мес». */
export function hoursChip(h: number): string {
  return h % 24 === 0 && h >= 48 ? formatCountRu(h / 24, ["день", "дня", "дней"]) : `${h} ч`;
}

export interface TemplateDraft {
  /** `null` — новый шаблон. */
  id: string | null;
  teamId: string;
  name: string;
  body: string;
  trigger: SmsWhen;
  hours: number | null;
  atTime: string | null;
  months: number | null;
  sendFrom: number;
  sendTo: number;
  enabled: boolean;
}

export function draftOf(t: SmsTeamTemplate): TemplateDraft {
  return {
    id: t.id,
    teamId: t.teamId,
    name: t.name,
    body: t.body,
    trigger: t.trigger,
    hours: t.hours,
    atTime: t.atTime,
    months: t.months,
    sendFrom: t.sendFrom,
    sendTo: t.sendTo,
    enabled: t.enabled,
  };
}

export function blankDraft(teamId: string): TemplateDraft {
  return {
    id: null,
    teamId,
    name: "",
    body: "",
    trigger: "manual",
    hours: null,
    atTime: null,
    months: null,
    sendFrom: 8,
    sendTo: 21,
    enabled: true,
  };
}

/** Сменить «когда»: срок нового варианта — прежний, если он подходит, иначе
 *  самый ходовой (за сутки, накануне в 18:00, через 2 часа, через 6 мес). */
export function withTrigger(d: TemplateDraft, trigger: SmsWhen): TemplateDraft {
  const next: TemplateDraft = { ...d, trigger, hours: null, atTime: null, months: null };
  if (trigger === "before") next.hours = d.trigger === "before" && d.hours ? d.hours : 24;
  if (trigger === "after") next.hours = d.trigger === "after" && d.hours ? d.hours : 2;
  if (trigger === "day_before") next.atTime = d.atTime ?? "18:00";
  if (trigger === "repeat") next.months = d.months ?? 6;
  return next;
}

/** Что мешает сохранить — первым словом; `null` — можно. Правила — те же,
 *  что проверяет база (`sms_team_templates_*_check`). */
export function draftProblem(d: TemplateDraft): string | null {
  if (!d.name.trim()) return "Назовите шаблон";
  if (d.name.trim().length > 60) return "Название длиннее 60 знаков";
  if (!d.body.trim()) return "Напишите текст";
  if (d.body.trim().length > 1000) return "Текст длиннее 1000 знаков";
  if (d.trigger === "before" && !(d.hours && d.hours >= 1 && d.hours <= 168)) return "Выберите, за сколько до визита";
  if (d.trigger === "after" && !(d.hours && d.hours >= 1 && d.hours <= 72)) return "Выберите, через сколько после визита";
  if (d.trigger === "day_before" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(d.atTime ?? "")) return "Выберите время накануне";
  if (d.trigger === "repeat" && !(d.months && d.months >= 1 && d.months <= 24)) return "Выберите, через сколько месяцев";
  if (!(d.sendFrom >= 0 && d.sendFrom <= 23 && d.sendTo >= 1 && d.sendTo <= 24 && d.sendFrom < d.sendTo)) {
    return "Окно отправки: «с» раньше, чем «до»";
  }
  return null;
}

/** Черновик — аргумент `sms_save_team_template`. */
export function draftPayload(d: TemplateDraft): Record<string, unknown> {
  return {
    ...(d.id ? { id: d.id } : null),
    team_id: d.teamId,
    name: d.name.trim(),
    body: d.body.trim(),
    trigger: d.trigger,
    hours: d.trigger === "before" || d.trigger === "after" ? d.hours : null,
    at_time: d.trigger === "day_before" ? d.atTime : null,
    months: d.trigger === "repeat" ? d.months : null,
    send_from: d.sendFrom,
    send_to: d.sendTo,
    enabled: d.enabled,
  };
}

/** Поля, которых у записи может не быть. Шаблон с таким пустым полем не
 *  уходит (SMS «ждём вас  в » клиенту не пишут) — владелец узнаёт об этом
 *  при настройке, а не из истории «не доставлено». */
const MAYBE_EMPTY: Record<string, string> = {
  Address: "адреса",
  Service: "услуги",
  Price: "цены",
  Amount: "долга",
};

/** «Уйдёт не всем: если у записи нет адреса или услуги…»; `null` — поля
 *  есть у каждой записи. */
export function emptyFieldsWarning(body: string): string | null {
  const missing = templateTokenKeys(body)
    .map((key) => MAYBE_EMPTY[key])
    .filter((x): x is string => !!x);
  if (missing.length === 0) return null;
  const list = missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(", ")} или ${missing[missing.length - 1]}`;
  return `Если у записи нет ${list}, SMS не уйдёт`;
}

/** Шаблоны списком «без повторов»: одинаковый текст у двух команд — одна
 *  строка (лист у номера клиента без записи видит все команды). */
export function uniqueByBody<T extends { body: string }>(list: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of list) {
    const key = item.body.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/** Готовые шаблоны для нового: тап ставит название, текст и «когда».
 *  Тексты — из полей, которые у записи есть всегда, чтобы SMS уходила
 *  каждому. */
export const READY_TEMPLATES: readonly (Pick<TemplateDraft, "name" | "body" | "trigger"> &
  Partial<Pick<TemplateDraft, "hours" | "atTime" | "months">>)[] = [
  { name: "Подтверждение записи", body: "[Имя], вы записаны: [День], [Дата] в [Время]. Ждём вас!", trigger: "created" },
  { name: "Напоминание накануне", body: "[Имя], напоминаем: завтра, [Дата], в [Время] у вас запись.", trigger: "day_before", atTime: "18:00" },
  { name: "За 2 часа", body: "[Имя], через 2 часа, в [Время], мы у вас.", trigger: "before", hours: 2 },
  { name: "Перенос", body: "[Имя], ваша запись перенесена: [День], [Дата] в [Время].", trigger: "rescheduled" },
  { name: "Отмена", body: "[Имя], ваша запись на [Дата] в [Время] отменена.", trigger: "cancelled" },
  { name: "Спасибо", body: "[Имя], спасибо, что выбрали нас! Будем рады видеть снова.", trigger: "after", hours: 2 },
  { name: "Пора повторить", body: "[Имя], прошло полгода с последнего визита — пора записаться снова.", trigger: "repeat", months: 6 },
  { name: "Выехал к вам", body: "[Имя], мастер выехал к вам.", trigger: "manual" },
];

/** Черновик по готовому шаблону — окно и «включён» остаются прежними. */
export function fromReady(d: TemplateDraft, ready: (typeof READY_TEMPLATES)[number]): TemplateDraft {
  const base = withTrigger({ ...d, name: ready.name, body: ready.body }, ready.trigger);
  return {
    ...base,
    hours: ready.hours ?? base.hours,
    atTime: ready.atTime ?? base.atTime,
    months: ready.months ?? base.months,
  };
}
