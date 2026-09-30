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
  /** Имя отправителя каждой команды; без него команда не отправляет.
   *  Необязательно: ответ, сохранённый в кэше до волны 10, его не несёт. */
  senders?: Record<string, string>;
  /** Отправка компании остановлена сверкой журнала (волна 13). */
  frozen?: boolean;
  /** Только владельцу. */
  owner: {
    /** Бывает меньше нуля: возврат или спор по карте после трат — долг. */
    balanceCents: number;
    freeLeft: number;
    monthCount: number;
    monthCents: number;
    teams: SmsTeamStats[];
    /** Сколько шаблонов у каждой команды. */
    templateCounts: Record<string, number>;
    /** Необязательны: ответ из кэша устройства до волны 13 их не несёт. */
    autotopup?: SmsAutotopup;
    /** Открытые тревоги: своей компании и, администратору, всей платформы. */
    alerts?: SmsAlert[];
  } | null;
}

/** Автопополнение с сохранённой карты (волна 13). */
export interface SmsAutotopup {
  enabled: boolean;
  thresholdCents: number;
  amountCents: number;
  /** «Visa •••• 4242»; нет — карта не сохранена. */
  card: string | null;
  /** Почему выключилось само (отказ банка, спор). */
  error: string | null;
}

export interface SmsAlert {
  kind: string;
  message: string;
  at: string;
  /** Тревога своей компании; иначе — платформы или партнёра. */
  own: boolean;
}

/** Пороги автопополнения, центы: «когда меньше €5 / €10 / €25». */
export const AUTOTOPUP_THRESHOLDS_CENTS = [500, 1000, 2500] as const;

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

function names(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  for (const [key, value] of Object.entries(v as Raw)) {
    if (typeof value === "string" && value.trim()) out[key] = value;
  }
  return out;
}

/** Имя отправителя: до 11 знаков, латиница, цифры и пробел, хотя бы одна
 *  буква — так его принимают операторы (на Кипре без регистрации). Те же
 *  правила проверяет база (`sms_save_team_sender`). `null` — годится. */
export function senderProblem(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name) return null;
  if (name.length > 11) return "Не длиннее 11 знаков";
  if (!/^[A-Za-z0-9 ]+$/.test(name)) return "Только латиница, цифры и пробел";
  if (!/[A-Za-z]/.test(name)) return "Нужна хотя бы одна буква";
  return null;
}

function parseAutotopup(v: unknown): SmsAutotopup {
  const r = (v && typeof v === "object" && !Array.isArray(v) ? v : {}) as Raw;
  const card = str(r.card);
  return {
    enabled: r.enabled === true && card !== null,
    thresholdCents: num(r.threshold_cents, 500),
    amountCents: num(r.amount_cents, 2500),
    card,
    error: str(r.error),
  };
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
    senders: names(r.senders),
    frozen: r.frozen === true,
    owner: owner
      ? {
          balanceCents: num(r.balance_cents),
          freeLeft: num(r.free_left),
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
          autotopup: parseAutotopup(r.autotopup),
          alerts: list(r.alerts)
            .map((e) => ({ kind: String(e.kind ?? ""), message: str(e.message) ?? "", at: String(e.at ?? ""), own: e.own === true }))
            .filter((a) => a.message !== ""),
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

/** Ниже этой суммы — «Пополните баланс» (владелец 30.09: «просто
 *  предупреждение на пяти — пополните баланс»). Центы. */
export const LOW_BALANCE_CENTS = 500;

/** Предупреждение о балансе словами; `null` — баланса хватает, он не виден
 *  (сотруднику) или SMS не настроены (ни у одной команды нет имени
 *  отправителя — пугать нечем). Пусто — SMS не уходят вовсе. */
export function balanceWarning(
  account: Pick<SmsAccount, "priceCents" | "owner" | "senders" | "frozen"> | null | undefined,
): string | null {
  const owner = account?.owner;
  if (!owner || !account) return null;
  // Заморозка и долг — всегда: деньги компании не сошлись или ушли назад.
  if (account.frozen) return FROZEN_WORDS;
  if (owner.balanceCents < 0) return "Долг по балансу — SMS не уходят";
  if (Object.keys(account.senders ?? {}).length === 0) return null;
  return owner.balanceCents < LOW_BALANCE_CENTS ? "Пополните баланс" : null;
}

/** Отправка остановлена сверкой: баланс не сошёлся с журналом денег. */
export const FROZEN_WORDS = "Отправка SMS остановлена — проверяем баланс";

/** Слова отказа базы — человеку. */
export function smsErrorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (message.includes("sms:frozen")) return FROZEN_WORDS;
  if (message.includes("sms:autotopup_card")) return "Сначала сохраните карту — оплатой с автопополнением";
  if (message.includes("sms:autotopup_amount")) return "Такой суммы нет";
  if (message.includes("sms:funds")) return "Не хватает баланса SMS";
  if (message.includes("sms:opt_out")) return "Клиент просил не присылать SMS";
  if (message.includes("sms:sender_format")) return "Имя отправителя: латиница, цифры, до 11 знаков";
  if (message.includes("sms:sender_taken")) return "Это имя занято — выберите другое";
  if (message.includes("sms:country")) return "На номера этой страны SMS не отправляются";
  if (message.includes("sms:limit")) return "На сегодня предел SMS сотрудника исчерпан";
  if (message.includes("sms:sender")) return "У команды не указано имя отправителя";
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
