// Разбор вызова `push_activity` и сборка сообщений Expo — без Deno и сети,
// чтобы правила гонялись `bun test`. Всё, что ходит в базу или в Expo, —
// в `PushDeps`; настоящие реализации — в `index.ts`.

import { PUSH_KINDS, renderActivity, type PushKind } from "./render.ts";

export interface PushTarget {
  user_id: string;
  kind: PushKind;
  team_id: string | null;
  show_client: boolean;
}

export interface LogRow {
  id: number;
  tenant_id: string;
  team_id: string | null;
  entity: string;
  entity_id: string | null;
  action: string;
  label: string | null;
  meta: Record<string, unknown> | null;
}

export interface AppointmentRow {
  id: string;
  date: string | null;
  time_start: string | null;
  city: string | null;
  client_id: string | null;
  team_id: string | null;
}

export interface DeviceRow {
  token: string;
  user_id: string;
  locale: string;
}

export interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  sound: "default";
  priority: "high";
  data: Record<string, string>;
}

export type ExpoTicket =
  | { status: "ok"; id?: string }
  | { status: "error"; message?: string; details?: { error?: string } };

export interface PushDeps {
  loadLog(id: number): Promise<LogRow | null>;
  loadAppointment(tenantId: string, id: string): Promise<AppointmentRow | null>;
  /** Запись дохода: к какой записи он относится. */
  loadIncomeAppointmentId(tenantId: string, id: string): Promise<string | null>;
  loadClientName(tenantId: string, id: string): Promise<string | null>;
  loadTeam(tenantId: string, id: string): Promise<{ name: string | null; timezone: string | null } | null>;
  loadOwners(tenantId: string, userIds: string[]): Promise<Set<string>>;
  loadCurrency(tenantId: string): Promise<string>;
  loadDevices(userIds: string[]): Promise<DeviceRow[]>;
  sendExpo(messages: ExpoMessage[]): Promise<ExpoTicket[]>;
  dropTokens(tokens: string[]): Promise<void>;
  now(): Date;
}

export interface PushResult {
  sent: number;
  failed: number;
  dropped: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_TZ = "Asia/Nicosia";
const EXPO_CHUNK = 100;

/** Тело вызова из `push_activity_dispatch`; чужое и битое — `null`. */
export function parseInput(raw: unknown): { logId: number; targets: PushTarget[] } | null {
  if (!raw || typeof raw !== "object") return null;
  const body = raw as Record<string, unknown>;
  const logId = body.log_id;
  if (typeof logId !== "number" || !Number.isSafeInteger(logId) || logId <= 0) return null;
  if (!Array.isArray(body.targets) || body.targets.length === 0 || body.targets.length > 500) return null;
  const targets: PushTarget[] = [];
  for (const item of body.targets) {
    if (!item || typeof item !== "object") return null;
    const t = item as Record<string, unknown>;
    if (typeof t.user_id !== "string" || !UUID_RE.test(t.user_id)) return null;
    if (typeof t.kind !== "string" || !PUSH_KINDS.includes(t.kind as PushKind)) return null;
    targets.push({
      user_id: t.user_id,
      kind: t.kind as PushKind,
      team_id: typeof t.team_id === "string" ? t.team_id : null,
      show_client: t.show_client === true,
    });
  }
  return { logId, targets };
}

/** Сегодня в часовом поясе команды. */
export function localToday(now: Date, timeZone: string | null): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || DEFAULT_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

const str = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);

export async function handlePushActivity(raw: unknown, deps: PushDeps): Promise<PushResult | null> {
  const input = parseInput(raw);
  if (!input) return null;
  const log = await deps.loadLog(input.logId);
  if (!log) return { sent: 0, failed: 0, dropped: 0 };

  // Запись: живая строка точнее журнала (город, клиент сейчас). Удалённой
  // нет — тогда дата, время и имя клиента из самого журнала.
  let appointmentId: string | null = null;
  if (log.entity === "appointments") appointmentId = log.entity_id;
  else if (log.entity === "finance_transactions" && log.entity_id) {
    appointmentId = await deps.loadIncomeAppointmentId(log.tenant_id, log.entity_id);
  }
  const appointment =
    appointmentId && log.action !== "delete" ? await deps.loadAppointment(log.tenant_id, appointmentId) : null;
  const teamId = appointment?.team_id ?? log.team_id;
  const team = teamId ? await deps.loadTeam(log.tenant_id, teamId) : null;
  const clientName =
    (appointment?.client_id ? await deps.loadClientName(log.tenant_id, appointment.client_id) : null) ??
    (log.entity === "appointments" ? str(log.label) : null);
  const amount = typeof log.meta?.amount === "number" ? log.meta.amount : null;
  const currency = log.entity === "finance_transactions" ? await deps.loadCurrency(log.tenant_id) : "EUR";
  const today = localToday(deps.now(), team?.timezone ?? null);

  const userIds = [...new Set(input.targets.map((t) => t.user_id))];
  const [owners, devices] = await Promise.all([
    deps.loadOwners(log.tenant_id, userIds),
    deps.loadDevices(userIds),
  ]);

  const messages: ExpoMessage[] = [];
  for (const target of input.targets) {
    // Тап открывает запись. Удалённую или ушедшую в чужой календарь открыть
    // нельзя — такой пуш просто открывает приложение.
    const data: Record<string, string> =
      appointment && appointment.date && target.kind !== "moved"
        ? {
            type: "calendar-appointment",
            appointmentId: appointment.id,
            date: appointment.date,
            ...(appointment.team_id ? { teamId: appointment.team_id } : {}),
            tenantId: log.tenant_id,
          }
        : { type: "team-activity", tenantId: log.tenant_id };
    for (const device of devices) {
      if (device.user_id !== target.user_id) continue;
      const { title, body } = renderActivity(
        {
          kind: target.kind,
          owner: owners.has(target.user_id),
          date: appointment?.date ?? str(log.meta?.date),
          time: appointment?.time_start ?? str(log.meta?.time),
          client: target.show_client ? clientName : null,
          city: appointment?.city ?? null,
          team: team?.name ?? null,
          amount,
          currency,
          today,
        },
        device.locale,
      );
      messages.push({ to: device.token, title, body, sound: "default", priority: "high", data });
    }
  }

  let sent = 0;
  let failed = 0;
  const dead: string[] = [];
  for (let i = 0; i < messages.length; i += EXPO_CHUNK) {
    const chunk = messages.slice(i, i + EXPO_CHUNK);
    let tickets: ExpoTicket[];
    try {
      tickets = await deps.sendExpo(chunk);
    } catch {
      failed += chunk.length;
      continue;
    }
    chunk.forEach((message, index) => {
      const ticket = tickets[index];
      if (ticket?.status === "ok") sent += 1;
      else {
        failed += 1;
        // Приложение удалили или токен отозван — больше на него не шлём.
        if (ticket?.status === "error" && ticket.details?.error === "DeviceNotRegistered") dead.push(message.to);
      }
    });
  }
  if (dead.length > 0) await deps.dropTokens(dead);
  return { sent, failed, dropped: dead.length };
}
