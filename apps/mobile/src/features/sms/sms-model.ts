// КАБИНЕТ SMS — ФОРМА ДАННЫХ (STORY-089). Чистый модуль: разбор ответа базы,
// черновик правки и слова отказов. Без React и сети — его читают тесты.

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
    autoNewTemplate: string | null;
    autoReminderTemplate: string | null;
    autoCancelTemplate: string | null;
    reminderHours: number;
    sender: string;
    monthCount: number;
    monthCents: number;
  } | null;
}

export interface SmsHistoryItem {
  id: string;
  createdAt: string;
  toPhone: string;
  clientId: string | null;
  clientName: string | null;
  appointmentId: string | null;
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

export function parseSmsAccount(data: unknown): SmsAccount {
  const r = (data && typeof data === "object" ? data : {}) as Raw;
  const owner = "balance_cents" in r;
  return {
    serviceOn: r.service_on === true,
    enabled: r.enabled === true,
    teamIds: Array.isArray(r.team_ids) ? r.team_ids.filter((x): x is string => typeof x === "string") : [],
    priceCents: num(r.price_cents, 10),
    canPay: r.can_pay === true,
    owner: owner
      ? {
          balanceCents: num(r.balance_cents),
          freeLeft: num(r.free_left),
          autoNewTemplate: str(r.auto_new_template),
          autoReminderTemplate: str(r.auto_reminder_template),
          autoCancelTemplate: str(r.auto_cancel_template),
          reminderHours: num(r.reminder_hours, 24),
          sender: str(r.sender) ?? "Babun",
          monthCount: num(r.month_count),
          monthCents: num(r.month_cents),
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
      toPhone: String(r.to_phone ?? ""),
      clientId: str(r.client_id),
      clientName: str(r.client_name),
      appointmentId: str(r.appointment_id),
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
  return message || "Не удалось отправить";
}

export type SmsSettingsPatch = Partial<{
  enabled: boolean;
  team_ids: string[];
  auto_new_template: string | null;
  auto_reminder_template: string | null;
  auto_cancel_template: string | null;
  reminder_hours: number;
}>;

/** Черновик ответа базы на правку — чтобы тумблер не ждал сеть. */
export function applyPatch(account: SmsAccount, patch: SmsSettingsPatch): SmsAccount {
  const owner = account.owner
    ? {
        ...account.owner,
        ...(patch.auto_new_template !== undefined ? { autoNewTemplate: patch.auto_new_template } : null),
        ...(patch.auto_reminder_template !== undefined ? { autoReminderTemplate: patch.auto_reminder_template } : null),
        ...(patch.auto_cancel_template !== undefined ? { autoCancelTemplate: patch.auto_cancel_template } : null),
        ...(patch.reminder_hours !== undefined ? { reminderHours: patch.reminder_hours } : null),
      }
    : null;
  return {
    ...account,
    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : null),
    ...(patch.team_ids !== undefined ? { teamIds: patch.team_ids } : null),
    owner,
  };
}

