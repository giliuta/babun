import { formatCountRu } from "@babun/shared/common/utils/plural-ru";
import { templateTokenKeys } from "@babun/shared/local/sms-templates";

// ШАБЛОНЫ SMS КОМАНДЫ — ФОРМА ДАННЫХ И ПРАВИЛА. Чистый
// модуль: разбор ответа базы, слова «когда», черновик настройки и его
// проверка. Без React и сети — его читают тесты.
//
// У каждой команды свои шаблоны; у шаблона настраивается, когда отправлять
// (за 24 часа или в такое-то время); тихих часов как понятия нет — шаблон
// программируется на определённое время. Поэтому:
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
  /** «До записи» — часы до начала; «После окончания записи» — часы после
   *  конца. «Визит» в интерфейсе не говорим: сущность — «Запись». */
  hours: number | null;
  /** «Накануне» — «ЧЧ:ММ» по времени календаря. */
  atTime: string | null;
  /** «Пора повторить» — месяцы после окончания записи. */
  months: number | null;
  /** Окно отправки, часы календаря: с `sendFrom` до `sendTo`. */
  sendFrom: number;
  sendTo: number;
  /** Вид строки — цвет и значок, как у меток и типов событий. */
  color: string | null;
  icon: string | null;
  /** `false` — «Скрыт»: сам не уходит и в листе отправки не предлагается. */
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
    color: typeof r.color === "string" && r.color ? r.color : null,
    icon: typeof r.icon === "string" && r.icon ? r.icon : null,
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
  before: "До записи",
  day_before: "Накануне",
  rescheduled: "При переносе",
  cancelled: "При отмене",
  after: "После окончания записи",
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
      return t.hours ? `За ${hoursSpan(t.hours)} до записи` : "До записи";
    case "day_before":
      return t.atTime ? `Накануне в ${t.atTime}` : "Накануне";
    case "rescheduled":
      return "При переносе записи";
    case "cancelled":
      return "При отмене записи";
    case "after":
      return t.hours ? `Через ${hoursSpan(t.hours)} после окончания записи` : "После окончания записи";
    case "repeat":
      return t.months ? `Через ${formatCountRu(t.months, ["месяц", "месяца", "месяцев"])} после окончания записи` : "Пора повторить";
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
  color: string;
  icon: string | null;
  enabled: boolean;
}

/** Цвет нового шаблона — первый цвет палитры, как у нового типа события. */
const DEFAULT_TEMPLATE_COLOR = "#3333FF";

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
    color: t.color ?? DEFAULT_TEMPLATE_COLOR,
    icon: t.icon,
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
    color: DEFAULT_TEMPLATE_COLOR,
    icon: null,
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
  if (d.trigger === "before" && !(d.hours && d.hours >= 1 && d.hours <= 168)) return "Выберите, за сколько до записи";
  if (d.trigger === "after" && !(d.hours && d.hours >= 1 && d.hours <= 72)) return "Выберите, через сколько после окончания записи";
  if (d.trigger === "day_before" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(d.atTime ?? "")) return "Выберите время накануне";
  if (d.trigger === "repeat" && !(d.months && d.months >= 1 && d.months <= 24)) return "Выберите, через сколько месяцев";
  // Автоматическое SMS собирает сервер, а долг клиента — это инвойсы и
  // платежи, которые считает только приложение: [Сумма] там не заполнится,
  // и шаблон не уходил бы никогда — молча.
  if (d.trigger !== "manual" && templateTokenKeys(d.body).includes("Amount")) {
    return "[Сумма] подставляется только в шаблон «Вручную»";
  }
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
    color: d.color,
    icon: d.icon,
    enabled: d.enabled,
  };
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

/** Порядок строк справочника: живые по `position`, скрытые — в конце (канон
 *  справочников: скрытая строка гаснет и падает вниз, а не исчезает). */
export function orderTemplates<T extends Pick<SmsTeamTemplate, "enabled" | "position">>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => Number(!a.enabled) - Number(!b.enabled) || a.position - b.position);
}
