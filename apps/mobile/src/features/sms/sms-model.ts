// КАБИНЕТ SMS — ФОРМА ДАННЫХ (STORY-089). Чистый модуль: разбор ответа базы,
// черновик правки и слова отказов. Без React и сети — его читают тесты.

/** Автоматические события — в том порядке, в каком их видит владелец. */
export const SMS_EVENTS = [
  "new_appointment",
  "reminder",
  "reminder_2",
  "reschedule",
  "cancellation",
  "thank_you",
  "repeat",
] as const;

export type SmsEvent = (typeof SMS_EVENTS)[number];

/** Событие у компании: текст по умолчанию, вкл/выкл и срок. */
export interface SmsEventRule {
  event: SmsEvent;
  on: boolean;
  body: string;
  /** Часы до (напоминания), часы после (спасибо), месяцы после (повторить). */
  timing: number | null;
  /** Текст поменян владельцем (не стандартный). */
  custom: boolean;
}

/** Своё правило команды: свой текст или «не отправлять». Нет правила —
 *  команда шлёт как компания. */
export interface SmsTeamRule {
  teamId: string;
  event: SmsEvent;
  mode: "on" | "off";
  body: string | null;
}

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
    quietFrom: number;
    quietTo: number;
    events: SmsEventRule[];
    teamRules: SmsTeamRule[];
    monthCount: number;
    monthCents: number;
    teams: SmsTeamStats[];
  } | null;
}

export interface SmsHistoryItem {
  id: string;
  createdAt: string;
  /** Ждёт отправки до этого момента (тихие часы, срок события). */
  sendAfter: string | null;
  toPhone: string;
  clientId: string | null;
  clientName: string | null;
  appointmentId: string | null;
  teamId: string | null;
  body: string | null;
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
const isEvent = (v: unknown): v is SmsEvent => SMS_EVENTS.includes(v as SmsEvent);
const list = (v: unknown): Raw[] => (Array.isArray(v) ? v.filter((x): x is Raw => !!x && typeof x === "object") : []);

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
          quietFrom: num(r.quiet_from, 21),
          quietTo: num(r.quiet_to, 8),
          events: list(r.events)
            .filter((e) => isEvent(e.event))
            .map((e) => ({
              event: e.event as SmsEvent,
              on: e.mode === "on",
              body: str(e.body) ?? "",
              timing: typeof e.timing === "number" ? e.timing : null,
              custom: e.custom === true,
            })),
          teamRules: list(r.team_rules)
            .filter((e) => isEvent(e.event) && typeof e.team_id === "string" && (e.mode === "on" || e.mode === "off"))
            .map((e) => ({
              teamId: e.team_id as string,
              event: e.event as SmsEvent,
              mode: e.mode as "on" | "off",
              body: str(e.body),
            })),
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
      status: (str(r.status) ?? "queued") as SmsHistoryItem["status"],
      trigger: String(r.trigger ?? ""),
      segments: typeof r.segments === "number" ? r.segments : null,
      costCents: num(r.cost_cents),
      wasFree: r.was_free === true,
      error: str(r.error),
    };
  });
}

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
  quiet_from: number;
  quiet_to: number;
}>;

/** Правка события: команда '' — текст компании; у команды 'inherit' —
 *  «как у компании». */
export interface SmsRulePatch {
  teamId: string;
  event: SmsEvent;
  mode: "on" | "off" | "inherit";
  body?: string | null;
  timing?: number | null;
}

/** Черновик ответа базы на правку — чтобы тумблер не ждал сеть. */
export function applyPatch(account: SmsAccount, patch: SmsSettingsPatch): SmsAccount {
  const owner = account.owner
    ? {
        ...account.owner,
        ...(patch.quiet_from !== undefined ? { quietFrom: patch.quiet_from } : null),
        ...(patch.quiet_to !== undefined ? { quietTo: patch.quiet_to } : null),
      }
    : null;
  return {
    ...account,
    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : null),
    ...(patch.team_ids !== undefined ? { teamIds: patch.team_ids } : null),
    owner,
  };
}

/** Черновик правки события. */
export function applyRule(account: SmsAccount, patch: SmsRulePatch): SmsAccount {
  const owner = account.owner;
  if (!owner) return account;
  if (patch.teamId === "") {
    return {
      ...account,
      owner: {
        ...owner,
        events: owner.events.map((e) =>
          e.event !== patch.event
            ? e
            : {
                ...e,
                on: patch.mode === "on",
                body: patch.body?.trim() ? patch.body.trim() : e.body,
                timing: patch.timing ?? e.timing,
                custom: patch.body?.trim() ? true : e.custom,
              },
        ),
      },
    };
  }
  const rest = owner.teamRules.filter((r) => !(r.teamId === patch.teamId && r.event === patch.event));
  const teamRules =
    patch.mode === "inherit"
      ? rest
      : [
          ...rest,
          {
            teamId: patch.teamId,
            event: patch.event,
            mode: patch.mode,
            body: patch.mode === "on" ? (patch.body?.trim() ?? null) : null,
          },
        ];
  return { ...account, owner: { ...owner, teamRules } };
}

/** Что команда шлёт на событие: «как у компании» (и что там), свой текст
 *  или ничего. */
export interface TeamEventState {
  mode: "inherit" | "on" | "off";
  /** Уйдёт ли SMS вообще. */
  sends: boolean;
  /** Текст, который уйдёт (или ушёл бы). */
  body: string;
}

export function teamEventState(account: SmsAccount, teamId: string, event: SmsEvent): TeamEventState {
  const owner = account.owner;
  const company = owner?.events.find((e) => e.event === event);
  const own = owner?.teamRules.find((r) => r.teamId === teamId && r.event === event);
  if (own?.mode === "off") return { mode: "off", sends: false, body: company?.body ?? "" };
  if (own?.mode === "on") return { mode: "on", sends: true, body: own.body ?? company?.body ?? "" };
  return { mode: "inherit", sends: !!company?.on, body: company?.body ?? "" };
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
