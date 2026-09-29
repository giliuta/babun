// КАБИНЕТ SMS — ФОРМА ДАННЫХ (STORY-089). Чистый модуль: разбор ответа базы,
// черновик правки и слова отказов. Без React и сети — его читают тесты.

import { parseTeamTemplates, type SmsTeamTemplate } from "./sms-team-templates";

/** Счёт месяца по команде. */
export interface SmsTeamStats {
  teamId: string;
  count: number;
  segments: number;
  cents: number;
  delivered: number;
  failed: number;
}

export interface SmsAccount {
  /** Сервис подключён у платформы (ключи Twilio заведены). */
  serviceOn: boolean;
  /** Владелец включил отправку через сервис. */
  enabled: boolean;
  /** Календари, где SMS через сервис разрешены. */
  teamIds: string[];
  /** Цена одной части SMS, центы EUR. */
  priceCents: number;
  /** Хватит ли на одну часть. */
  canPay: boolean;
  /** Только владельцу. */
  owner: {
    balanceCents: number;
    freeLeft: number;
    sender: string;
    monthCount: number;
    monthCents: number;
    teams: SmsTeamStats[];
    /** Сколько шаблонов у каждой команды. */
    templateCounts: Record<string, number>;
  } | null;
}

export interface SmsHistoryItem {
  id: string;
  createdAt: string;
  /** Ждёт отправки до этого момента (окно шаблона, срок). */
  sendAfter: string | null;
  toPhone: string;
  clientId: string | null;
  clientName: string | null;
  appointmentId: string | null;
  teamId: string | null;
  body: string | null;
  /** Текст шаблона до подстановки — у сообщения, которое ещё не ушло. */
  templateBody: string | null;
  /** Шаблон, по которому ушло (если он ещё есть). */
  templateName: string | null;
  status: "queued" | "sending" | "sent" | "delivered" | "failed" | "undelivered" | "blocked";
  trigger: string;
  segments: number | null;
  costCents: number;
  wasFree: boolean;
  error: string | null;
}

type Raw = Record<string, unknown>;

const num = (v: unknown, fallback = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const list = (v: unknown): Raw[] => (Array.isArray(v) ? v.filter((x): x is Raw => !!x && typeof x === "object") : []);

function counts(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  for (const [key, value] of Object.entries(v as Raw)) {
    if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
  }
  return out;
}

export function parseSmsAccount(data: unknown): SmsAccount {
  const r = (data && typeof data === "object" ? data : {}) as Raw;
  const owner = "balance_cents" in r;
  const month = (r.month && typeof r.month === "object" ? r.month : {}) as Raw;
  return {
    serviceOn: r.service_on === true,
    enabled: r.enabled === true,
    teamIds: Array.isArray(r.team_ids) ? r.team_ids.filter((x): x is string => typeof x === "string") : [],
    priceCents: num(r.price_cents, 12),
    canPay: r.can_pay === true,
    owner: owner
      ? {
          balanceCents: num(r.balance_cents),
          freeLeft: num(r.free_left),
          sender: str(r.sender) ?? "Babun",
          monthCount: num(month.count),
          monthCents: num(month.cents),
          teams: list(r.teams).map((e) => ({
            teamId: String(e.team_id ?? ""),
            count: num(e.count),
            segments: num(e.segments),
            cents: num(e.cents),
            delivered: num(e.delivered),
            failed: num(e.failed),
          })),
          templateCounts: counts(r.template_counts),
        }
      : null,
  };
}

export function parseSmsHistory(rows: unknown): SmsHistoryItem[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    const r = (row ?? {}) as Raw;
    return {
      id: String(r.id ?? ""),
      createdAt: String(r.created_at ?? ""),
      sendAfter: str(r.send_after),
      toPhone: String(r.to_phone ?? ""),
      clientId: str(r.client_id),
      clientName: str(r.client_name),
      appointmentId: str(r.appointment_id),
      teamId: str(r.team_id),
      body: str(r.body),
      templateBody: str(r.template_body),
      templateName: str(r.template_name),
      status: (str(r.status) ?? "queued") as SmsHistoryItem["status"],
      trigger: String(r.trigger ?? ""),
      segments: typeof r.segments === "number" ? r.segments : null,
      costCents: num(r.cost_cents),
      wasFree: r.was_free === true,
      error: str(r.error),
    };
  });
}

/** SMS записи: сообщения и включённые шаблоны её команды — ими лист
 *  «Отправить SMS» предлагает текст. */
export interface SmsRecordLog {
  templates: SmsTeamTemplate[];
  messages: SmsHistoryItem[];
  /** Ответ клиента по ссылке «Подтвердить / Отменить» и когда он был. */
  clientAnswer: "confirmed" | "cancelled" | null;
  clientAnsweredAt: string | null;
}

export function parseSmsRecordLog(data: unknown): SmsRecordLog {
  const r = (data && typeof data === "object" ? data : {}) as Raw;
  const answer = r.client_answer === "confirmed" || r.client_answer === "cancelled" ? r.client_answer : null;
  return {
    templates: parseTeamTemplates(r.templates),
    messages: parseSmsHistory(r.messages),
    clientAnswer: answer,
    clientAnsweredAt: answer ? str(r.client_answered_at) : null,
  };
}

/** Просит ли текст ссылку «Подтвердить / Отменить». */
export const wantsLink = (body: string | null | undefined): boolean => /\[(Ссылка|Link)\]/u.test(body ?? "");

/** Слова отказа базы — человеку. */
export function smsErrorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (message.includes("sms:funds")) return "Не хватает баланса SMS";
  if (message.includes("sms:opt_out")) return "Клиент просил не присылать SMS";
  if (message.includes("sms:calendar")) return "SMS в этом календаре выключены";
  if (message.includes("sms:disabled")) return "Отправка через сервис выключена";
  if (message.includes("sms:service_off")) return "Сервис SMS ещё не подключён";
  if (message.includes("sms:phone")) return "У клиента нет номера";
  if (message.includes("sms:rights")) return "Нет доступа к отправке";
  if (message.includes("sms: empty body")) return "Напишите текст SMS";
  return message || "Не удалось отправить";
}

export type SmsSettingsPatch = Partial<{
  enabled: boolean;
  team_ids: string[];
}>;

/** Черновик ответа базы на правку — чтобы тумблер не ждал сеть. */
export function applyPatch(account: SmsAccount, patch: SmsSettingsPatch): SmsAccount {
  return {
    ...account,
    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : null),
    ...(patch.team_ids !== undefined ? { teamIds: patch.team_ids } : null),
  };
}

/** Счёт команды за месяц; нет сообщений — нули. */
export function teamStats(account: SmsAccount, teamId: string): SmsTeamStats {
  return (
    account.owner?.teams.find((s) => s.teamId === teamId) ?? {
      teamId,
      count: 0,
      segments: 0,
      cents: 0,
      delivered: 0,
      failed: 0,
    }
  );
}
