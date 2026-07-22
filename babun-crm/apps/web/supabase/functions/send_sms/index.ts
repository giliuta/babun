// STORY-069 wave 3 — send_sms Edge Function (LIVE).
//
// Driven by pg_cron every 5 minutes. Sweeps appointments that need a
// 24h or 2h reminder and sends them via the platform's single Twilio
// account. The per-tenant BYOK model from STORY-047 is dropped.
//
// Send mechanics:
//   * sender = tenant_sms_config.sender_name when sender_status='approved',
//     else PLATFORM_DEFAULT_SENDER ("Babun"). Cyprus (Babun's first
//     country) doesn't require Alpha Sender registration, so the
//     fallback works without paperwork.
//   * cost = PER_SMS_COST_CENTS per send. Free trial slots
//     (free_sms_remaining) consumed first, then balance_cents.
//     Tenant blocked when both are exhausted.
//
// Idempotency: sms_messages has a partial UNIQUE on
// (appointment_id, trigger_type). The function atomically claims that row
// before Twilio, so overlapping cron runs cannot both perform the side effect;
// the earlier lookup is only a round-trip optimisation.
//
// Time window: ±5 min around T-24h / T-2h in the brigade timezone,
// falling back to the tenant calendar timezone.
//
// Master switch: app_settings.sms_enabled = 'on' required. Off →
// the function returns immediately without scanning.
//
// Dual-write: every send inserts into sms_messages (legacy — the
// Twilio status webhook + Settings/Billing UI still read from it)
// AND sms_logs (new — /admin dashboards + STORY-069 SMS history UI).
// Both rows share the Twilio MessageSid for cross-table joins.
//
// CORS: server-to-server only (pg_cron via pg_net). Open for now.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import {
  dateKeyInTimeZone,
  isValidTimeZone,
  resolveTenantTimeZone,
  tenantLocalToUtc,
} from "./time.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

// ─── Pricing / sender constants ──────────────────────────────────
// Mirror the values in src/app/dashboard/settings/sms/sms-constants.ts.
// Edge runtime can't import from the Next app, so keep them in sync
// by hand — both locations comment-link this duplication.
const PER_SMS_COST_CENTS = 10;
const PLATFORM_DEFAULT_SENDER = "Babun";

// ─── Types ────────────────────────────────────────────────────────

type TriggerType = "reminder_24h" | "reminder_2h" | "manual" | "test";

interface TenantSmsConfig {
  tenant_id: string;
  enabled: boolean;
  remind_24h_before: boolean;
  remind_2h_before: boolean;
  template_24h: string;
  template_2h: string;
  sender_name: string | null;
  sender_status: "pending" | "approved" | "rejected" | null;
  balance_cents: number;
  free_sms_remaining: number;
  total_sent_count: number;
  // Legacy mode/quota fields are still on the row but unused in v3.
  mode: "platform" | "byok";
}

interface AppointmentRow {
  id: string;
  tenant_id: string;
  client_id: string | null;
  team_id: string | null;
  date: string;
  time_start: string;
  reminder_enabled: boolean;
}

interface ClientRow {
  id: string;
  full_name: string | null;
  phone: string | null;
}

interface TenantRow {
  id: string;
  name: string;
}

interface TeamTimeZoneRow {
  id: string;
  timezone: string | null;
}

interface SendSmsResponse {
  matched: number;
  sent: number;
  blocked: number;
  skipped: number;
  failed: number;
  errors: Array<{ tenant_id: string; appointment_id?: string; reason: string }>;
}

type SmsCharge = "free" | "paid";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown, field: string): string | null {
  if (!isRecord(value)) return null;
  const candidate = value[field];
  return typeof candidate === "string" ? candidate : null;
}

function parseTenantSmsConfig(value: unknown): TenantSmsConfig | null {
  if (!isRecord(value)) return null;

  const tenantId = value.tenant_id;
  const senderName = value.sender_name;
  const senderStatus = value.sender_status;
  const mode = value.mode;
  if (
    typeof tenantId !== "string" ||
    typeof value.enabled !== "boolean" ||
    typeof value.remind_24h_before !== "boolean" ||
    typeof value.remind_2h_before !== "boolean" ||
    typeof value.template_24h !== "string" ||
    typeof value.template_2h !== "string" ||
    (senderName !== null && typeof senderName !== "string") ||
    (senderStatus !== null &&
      senderStatus !== "pending" &&
      senderStatus !== "approved" &&
      senderStatus !== "rejected") ||
    typeof value.balance_cents !== "number" ||
    !Number.isFinite(value.balance_cents) ||
    typeof value.free_sms_remaining !== "number" ||
    !Number.isFinite(value.free_sms_remaining) ||
    typeof value.total_sent_count !== "number" ||
    !Number.isFinite(value.total_sent_count) ||
    (mode !== "platform" && mode !== "byok")
  ) {
    return null;
  }

  return {
    tenant_id: tenantId,
    enabled: value.enabled,
    remind_24h_before: value.remind_24h_before,
    remind_2h_before: value.remind_2h_before,
    template_24h: value.template_24h,
    template_2h: value.template_2h,
    sender_name: senderName,
    sender_status: senderStatus,
    balance_cents: value.balance_cents,
    free_sms_remaining: value.free_sms_remaining,
    total_sent_count: value.total_sent_count,
    mode,
  };
}

// ─── Supabase + Twilio bootstrap ─────────────────────────────────

function buildServiceClient(): ReturnType<typeof createClient> | null {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const secretKeysJson = Deno.env.get("SUPABASE_SECRET_KEYS");
  const legacyServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  let serviceKey: string | undefined;
  if (secretKeysJson) {
    try {
      const candidates = Object.values(
        JSON.parse(secretKeysJson) as Record<string, unknown>,
      ).filter(
        (value): value is string =>
          typeof value === "string" && value.length > 20,
      );
      serviceKey =
        candidates.find((value) => value.startsWith("sb_secret_")) ??
        candidates[0];
    } catch {
      /* fall through */
    }
  }
  if (!serviceKey) serviceKey = legacyServiceKey || undefined;
  if (!supabaseUrl || !serviceKey) return null;
  return createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function bearerToken(request: Request): string | null {
  return (
    request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null
  );
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index++) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

async function authorizeOwnerTestSend(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  request: Request,
  tenantId: string,
): Promise<boolean> {
  const token = bearerToken(request);
  if (!token) return false;
  const { data: authData, error: authError } =
    await supabase.auth.getUser(token);
  const userId = authData?.user?.id;
  if (authError || !userId) return false;

  const { data: membership, error: membershipError } = await supabase
    .from("tenant_members")
    .select("tenant_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("role", "owner")
    .maybeSingle();
  return !membershipError && membership?.tenant_id === tenantId;
}

async function authorizeCronSweep(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  request: Request,
): Promise<boolean> {
  const supplied = request.headers.get("x-cron-secret") ?? "";
  if (!supplied) return false;
  const { data, error } = await supabase
    .from("edge_cron_secrets")
    .select("secret")
    .eq("name", "send_sms")
    .single();
  return (
    !error &&
    typeof data?.secret === "string" &&
    constantTimeEqual(supplied, data.secret)
  );
}

async function reserveSmsCredit(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  tenantId: string,
): Promise<{ charge: SmsCharge | null; error: string | null }> {
  const { data, error } = await supabase.rpc("reserve_sms_credit", {
    p_tenant_id: tenantId,
  });
  if (error)
    return {
      charge: null,
      error: error.message ?? "credit reservation failed",
    };
  return {
    charge: data === "free" || data === "paid" ? data : null,
    error: null,
  };
}

async function releaseSmsCredit(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  tenantId: string,
  charge: SmsCharge,
): Promise<string | null> {
  const { error } = await supabase.rpc("release_sms_credit", {
    p_tenant_id: tenantId,
    p_charge: charge,
  });
  return error?.message ?? null;
}

interface TwilioCreds {
  accountSid: string;
  authToken: string;
  // Optional: status callback URL Twilio POSTs delivery updates to.
  // Falls back to the public default when unset.
  statusCallbackUrl: string | null;
}

function readTwilioCreds(): TwilioCreds | null {
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  if (!accountSid || !authToken) return null;
  const statusCallbackUrl =
    Deno.env.get("TWILIO_STATUS_CALLBACK_URL") ??
    "https://babun.app/api/twilio/status";
  return { accountSid, authToken, statusCallbackUrl };
}

// ─── Twilio call ─────────────────────────────────────────────────
//
// Uses the form-encoded REST endpoint directly. Avoids a Twilio SDK
// in the Deno runtime — keeps the function lean and there's no SDK
// shim we'd need anyway.
interface TwilioSendResult {
  ok: true;
  sid: string;
  status: string;
}
interface TwilioSendError {
  ok: false;
  status: string | null;
  errorCode: string | null;
  errorMessage: string;
}

async function twilioSend(
  creds: TwilioCreds,
  from: string,
  to: string,
  body: string,
): Promise<TwilioSendResult | TwilioSendError> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(creds.accountSid)}/Messages.json`;
  const auth = btoa(`${creds.accountSid}:${creds.authToken}`);

  const form = new URLSearchParams();
  form.set("To", to);
  form.set("From", from);
  form.set("Body", body);
  if (creds.statusCallbackUrl)
    form.set("StatusCallback", creds.statusCallbackUrl);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
  } catch (err) {
    return {
      ok: false,
      status: null,
      errorCode: "network_error",
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = await res.json();
  } catch {
    /* ignore — error path below handles missing body */
  }

  if (!res.ok) {
    return {
      ok: false,
      status: typeof payload.status === "string" ? payload.status : null,
      errorCode:
        typeof payload.code === "number" || typeof payload.code === "string"
          ? String(payload.code)
          : `http_${res.status}`,
      errorMessage:
        typeof payload.message === "string"
          ? payload.message
          : `Twilio HTTP ${res.status}`,
    };
  }

  return {
    ok: true,
    sid: String(payload.sid ?? ""),
    status: typeof payload.status === "string" ? payload.status : "queued",
  };
}

// ─── Time helpers ─────────────────────────────────────────────────

const WINDOW_MINUTES = 5;

function isWithinWindow(target: Date, center: Date, mins: number): boolean {
  return Math.abs(target.getTime() - center.getTime()) <= mins * 60_000;
}

function formatDateRu(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  const months = [
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
  ];
  return `${day} ${months[month] ?? ""}`.trim();
}

function renderTemplate(
  template: string,
  ctx: {
    client_name: string;
    time: string;
    date: string;
    phone: string;
    business_name: string;
  },
): string {
  return template
    .replaceAll("{client_name}", ctx.client_name)
    .replaceAll("{time}", ctx.time)
    .replaceAll("{date}", ctx.date)
    .replaceAll("{phone}", ctx.phone)
    .replaceAll("{business_name}", ctx.business_name);
}

function senderForConfig(cfg: TenantSmsConfig): string {
  return cfg.sender_status === "approved" && cfg.sender_name
    ? cfg.sender_name
    : PLATFORM_DEFAULT_SENDER;
}

// ─── Main handler ────────────────────────────────────────────────

// P2 #42 — single test-send. Validates tenant is enabled + has
// balance, calls Twilio once, decrements balance, logs to
// sms_messages with trigger_type='test'. Returns the message id +
// status so the UI can show «Отправлено · SID...» feedback.
async function handleTestSend(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  body: { tenant_id?: string; to_phone?: string; body?: string },
): Promise<Response> {
  const tenantId = body.tenant_id?.trim() ?? "";
  const toPhone = body.to_phone?.trim() ?? "";
  const message = body.body?.trim() ?? "";
  if (!tenantId || !toPhone || !message) {
    return jsonResponse(400, {
      error: "test_send_invalid",
      hint: "tenant_id, to_phone and body are all required.",
    });
  }

  const twilio = readTwilioCreds();
  if (!twilio) {
    return jsonResponse(503, {
      error: "twilio_not_configured",
      hint: "Set TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN in Edge Function Secrets.",
    });
  }

  const { data: cfg, error: cfgErr } = await supabase
    .from("tenant_sms_config")
    .select("*")
    .eq("tenant_id", tenantId)
    .single();
  if (cfgErr || !cfg) {
    return jsonResponse(404, {
      error: "tenant_sms_config_missing",
      hint: cfgErr?.message ?? "no config row for this tenant",
    });
  }
  if (!cfg.enabled) {
    return jsonResponse(403, { error: "sms_disabled_for_tenant" });
  }

  const reservation = await reserveSmsCredit(supabase, tenantId);
  if (reservation.error) {
    return jsonResponse(503, {
      error: "sms_credit_reservation_failed",
    });
  }
  if (!reservation.charge) {
    return jsonResponse(402, {
      error: "balance_exhausted",
      hint: "Buy more SMS credit before sending a test.",
    });
  }

  const sender =
    cfg.sender_status === "approved" && cfg.sender_name
      ? cfg.sender_name
      : PLATFORM_DEFAULT_SENDER;

  const send = await twilioSend(twilio, sender, toPhone, message);
  if (!send.ok) {
    const releaseError = await releaseSmsCredit(
      supabase,
      tenantId,
      reservation.charge,
    );
    return jsonResponse(502, {
      error: "twilio_send_failed",
      status: send.status,
      errorCode: send.errorCode,
      errorMessage: send.errorMessage,
      creditReleasePending: releaseError !== null,
    });
  }

  // Log to both tables — the legacy sms_messages and the new
  // sms_logs — so /admin + history UI both reflect the test send.
  const nowIso = new Date().toISOString();
  await supabase.from("sms_messages").insert({
    tenant_id: tenantId,
    appointment_id: null,
    client_id: null,
    trigger_type: "test",
    twilio_sid: send.sid,
    to_phone: toPhone,
    message_body: message,
    status: send.status === "sent" ? "sent" : "queued",
    mode: "platform",
  });
  await supabase.from("sms_logs").insert({
    tenant_id: tenantId,
    to_phone: toPhone,
    body: message,
    sender_name_used: sender,
    cost_cents: reservation.charge === "free" ? 0 : PER_SMS_COST_CENTS,
    was_free: reservation.charge === "free",
    twilio_message_sid: send.sid,
    twilio_status: send.status,
    created_at: nowIso,
  });

  return jsonResponse(200, { ok: true, sid: send.sid, status: send.status });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "method not allowed" });
  }

  const supabase = buildServiceClient();
  if (!supabase) {
    return jsonResponse(500, { error: "service-role client unavailable" });
  }

  // P2 #42 (CRM Core brief) — test-send mode. Bypasses the
  // sweep/cron path entirely: the caller hands us {mode:"test",
  // tenant_id, to_phone, body}, we charge one SMS to the tenant's
  // balance (or a free-trial slot) and dispatch via Twilio. Logged
  // with `trigger_type: 'test'` so the history UI labels it
  // distinctly.
  let body: {
    mode?: string;
    tenant_id?: string;
    to_phone?: string;
    body?: string;
  } | null = null;
  try {
    const text = await req.clone().text();
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (body?.mode === "test") {
    const tenantId = body.tenant_id?.trim() ?? "";
    if (!tenantId || !(await authorizeOwnerTestSend(supabase, req, tenantId))) {
      return jsonResponse(403, { error: "owner_authorization_required" });
    }
    return handleTestSend(supabase, body);
  }

  if (!(await authorizeCronSweep(supabase, req))) {
    return jsonResponse(401, { error: "cron_authorization_required" });
  }

  // ── Master switch ────────────────────────────────────────────
  const { data: flagRow, error: flagErr } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "sms_enabled")
    .maybeSingle();
  if (flagErr) {
    return jsonResponse(500, { error: `app_settings: ${flagErr.message}` });
  }
  if (!flagRow || flagRow.value !== "on") {
    return jsonResponse(200, {
      matched: 0,
      sent: 0,
      blocked: 0,
      skipped: 0,
      failed: 0,
      errors: [],
      reason: "sms_enabled_off",
    } satisfies SendSmsResponse & { reason: string });
  }

  const twilio = readTwilioCreds();
  if (!twilio) {
    return jsonResponse(503, {
      error: "twilio_not_configured",
      hint: "Set TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN in Edge Function Secrets.",
    });
  }

  // ── Sweep enabled tenants ────────────────────────────────────
  const { data: configs, error: cfgErr } = await supabase
    .from("tenant_sms_config")
    .select("*")
    .eq("enabled", true);
  if (cfgErr) {
    return jsonResponse(500, { error: `tenant_sms_config: ${cfgErr.message}` });
  }

  const now = new Date();
  const t24 = new Date(now.getTime() + 24 * 60 * 60_000);
  const t02 = new Date(now.getTime() + 2 * 60 * 60_000);

  const out: SendSmsResponse = {
    matched: 0,
    sent: 0,
    blocked: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  for (const rawConfig of configs ?? []) {
    const cfg = parseTenantSmsConfig(rawConfig);
    if (!cfg) {
      out.errors.push({
        tenant_id: stringField(rawConfig, "tenant_id") ?? "unknown",
        reason: "invalid tenant SMS config",
      });
      continue;
    }
    try {
      const { data: tenant, error: tenantErr } = await supabase
        .from("tenants")
        .select("id,name")
        .eq("id", cfg.tenant_id)
        .single();
      if (tenantErr || !tenant) {
        out.errors.push({
          tenant_id: cfg.tenant_id,
          reason: `tenant lookup: ${tenantErr?.message ?? "not found"}`,
        });
        continue;
      }

      const { data: calendarSettings, error: calendarSettingsErr } =
        await supabase
          .from("calendar_settings")
          .select("timezone")
          .eq("tenant_id", cfg.tenant_id)
          .maybeSingle();
      if (calendarSettingsErr) {
        out.errors.push({
          tenant_id: cfg.tenant_id,
          reason: `calendar timezone: ${calendarSettingsErr.message}`,
        });
        continue;
      }
      const tenantTimeZone = resolveTenantTimeZone(calendarSettings?.timezone);
      if (!tenantTimeZone) {
        out.errors.push({
          tenant_id: cfg.tenant_id,
          reason: "invalid calendar timezone",
        });
        continue;
      }

      const { data: teamRows, error: teamsErr } = await supabase
        .from("teams")
        .select("id,timezone")
        .eq("tenant_id", cfg.tenant_id);
      if (teamsErr) {
        out.errors.push({
          tenant_id: cfg.tenant_id,
          reason: `team timezones: ${teamsErr.message}`,
        });
        continue;
      }
      const timeZoneByTeam = new Map<string, string>();
      const invalidTimeZoneTeamIds = new Set<string>();
      for (const team of (teamRows ?? []) as TeamTimeZoneRow[]) {
        const timeZone = team.timezone?.trim();
        if (!timeZone) continue;
        if (!isValidTimeZone(timeZone)) {
          out.errors.push({
            tenant_id: cfg.tenant_id,
            reason: `invalid team timezone (${team.id})`,
          });
          invalidTimeZoneTeamIds.add(team.id);
          continue;
        }
        timeZoneByTeam.set(team.id, timeZone);
      }

      const candidateDates = new Set<string>();
      for (const timeZone of new Set([
        tenantTimeZone,
        ...timeZoneByTeam.values(),
      ])) {
        candidateDates.add(dateKeyInTimeZone(now, timeZone));
        candidateDates.add(
          dateKeyInTimeZone(
            new Date(now.getTime() + 25 * 60 * 60_000),
            timeZone,
          ),
        );
      }
      const { data: appts, error: apptErr } = await supabase
        .from("appointments")
        .select(
          "id,tenant_id,client_id,team_id,date,time_start,reminder_enabled",
        )
        .eq("tenant_id", cfg.tenant_id)
        .eq("status", "scheduled")
        // Appointment opt-in is authoritative. `= true` deliberately
        // excludes legacy/null rows as well as explicit false; tenant SMS
        // settings only decide *when* an opted-in appointment is notified.
        .eq("reminder_enabled", true)
        .in("date", [...candidateDates]);
      if (apptErr) {
        out.errors.push({
          tenant_id: cfg.tenant_id,
          reason: `appointments: ${apptErr.message}`,
        });
        continue;
      }

      for (const apt of (appts ?? []) as AppointmentRow[]) {
        // A corrupt team zone must never silently inherit another zone: skip
        // only the affected team's appointments and keep other teams live.
        if (apt.team_id && invalidTimeZoneTeamIds.has(apt.team_id)) continue;
        const appointmentTimeZone =
          (apt.team_id ? timeZoneByTeam.get(apt.team_id) : null) ??
          tenantTimeZone;
        const startUtc = tenantLocalToUtc(
          apt.date,
          apt.time_start,
          appointmentTimeZone,
        );
        if (!startUtc) continue;

        let trigger: TriggerType | null = null;
        if (
          cfg.remind_24h_before &&
          isWithinWindow(startUtc, t24, WINDOW_MINUTES)
        ) {
          trigger = "reminder_24h";
        } else if (
          cfg.remind_2h_before &&
          isWithinWindow(startUtc, t02, WINDOW_MINUTES)
        ) {
          trigger = "reminder_2h";
        }
        if (!trigger) continue;

        out.matched++;

        // Idempotency pre-check on sms_messages legacy table —
        // partial UNIQUE on (appointment_id, trigger_type).
        const { data: existing } = await supabase
          .from("sms_messages")
          .select("id")
          .eq("appointment_id", apt.id)
          .eq("trigger_type", trigger)
          .maybeSingle();
        if (existing) {
          out.skipped++;
          continue;
        }

        // Recipient + body.
        let client: ClientRow | null = null;
        if (apt.client_id) {
          const { data: c } = await supabase
            .from("clients")
            .select("id,full_name,phone")
            .eq("id", apt.client_id)
            .maybeSingle();
          client = (c as ClientRow | null) ?? null;
        }
        const toPhone = client?.phone ?? "";
        if (!toPhone) {
          out.errors.push({
            tenant_id: cfg.tenant_id,
            appointment_id: apt.id,
            reason: "client phone missing",
          });
          continue;
        }

        const templateRaw =
          trigger === "reminder_24h" ? cfg.template_24h : cfg.template_2h;
        const body = renderTemplate(templateRaw, {
          client_name: client?.full_name ?? "клиент",
          time: apt.time_start,
          date: formatDateRu(apt.date),
          phone: toPhone,
          business_name: (tenant as TenantRow).name ?? "",
        });

        // The UNIQUE insert is the authoritative idempotency gate. It happens
        // before Twilio because a lookup alone is racy across overlapping cron
        // invocations. A claimed row favours at-most-once delivery if the
        // process crashes mid-send, which is safer than duplicate reminders.
        const { data: claim, error: claimError } = await supabase
          .from("sms_messages")
          .insert({
            tenant_id: cfg.tenant_id,
            appointment_id: apt.id,
            client_id: client?.id ?? null,
            to_phone: toPhone,
            message_body: body,
            status: "queued",
            trigger_type: trigger,
            mode: "platform",
          })
          .select("id")
          .single();
        const claimId = stringField(claim, "id");
        if (claimError || !claimId) {
          if (claimError?.code === "23505") out.skipped++;
          else {
            out.errors.push({
              tenant_id: cfg.tenant_id,
              appointment_id: apt.id,
              reason: "failed to claim SMS reminder",
            });
          }
          continue;
        }

        // Reserve credit under a PostgreSQL row lock. Overlapping cron runs and
        // owner test sends can no longer spend the same free slot/balance.
        const reservation = await reserveSmsCredit(supabase, cfg.tenant_id);
        if (reservation.error) {
          await supabase
            .from("sms_messages")
            .update({
              status: "failed",
              error_code: "credit_reservation_failed",
              error_message: "SMS credit reservation failed",
            })
            .eq("id", claimId);
          out.failed++;
          out.errors.push({
            tenant_id: cfg.tenant_id,
            appointment_id: apt.id,
            reason: "SMS credit reservation failed",
          });
          continue;
        }
        if (!reservation.charge) {
          await supabase
            .from("sms_messages")
            .update({
              status: "failed",
              error_code: "no_credit",
              error_message:
                "Бесплатные SMS закончились, баланс < стоимости отправки",
            })
            .eq("id", claimId);
          await supabase.from("sms_logs").insert({
            tenant_id: cfg.tenant_id,
            to_phone: toPhone,
            body,
            sender_name_used: senderForConfig(cfg),
            cost_cents: 0,
            was_free: false,
            error_code: "no_credit",
            error_message: "no_credit",
            appointment_id: apt.id,
          });
          out.blocked++;
          continue;
        }

        const senderName = senderForConfig(cfg);
        const result = await twilioSend(twilio, senderName, toPhone, body);

        if (!result.ok) {
          const releaseError = await releaseSmsCredit(
            supabase,
            cfg.tenant_id,
            reservation.charge,
          );
          await supabase
            .from("sms_messages")
            .update({
              status: "failed",
              error_code: result.errorCode,
              error_message: result.errorMessage,
            })
            .eq("id", claimId);
          await supabase.from("sms_logs").insert({
            tenant_id: cfg.tenant_id,
            to_phone: toPhone,
            body,
            sender_name_used: senderName,
            cost_cents: 0,
            was_free: reservation.charge === "free",
            twilio_status: result.status ?? "failed",
            error_code: result.errorCode,
            error_message: result.errorMessage,
            appointment_id: apt.id,
          });
          if (releaseError) {
            out.errors.push({
              tenant_id: cfg.tenant_id,
              appointment_id: apt.id,
              reason: "SMS credit release requires reconciliation",
            });
          }
          out.failed++;
          continue;
        }

        // Success — finalize the claimed legacy row + write the managed log.
        await supabase
          .from("sms_messages")
          .update({
            status: "sent",
            twilio_sid: result.sid,
            error_code: null,
            error_message: null,
          })
          .eq("id", claimId);
        await supabase.from("sms_logs").insert({
          tenant_id: cfg.tenant_id,
          to_phone: toPhone,
          body,
          sender_name_used: senderName,
          cost_cents: reservation.charge === "free" ? 0 : PER_SMS_COST_CENTS,
          was_free: reservation.charge === "free",
          twilio_message_sid: result.sid,
          twilio_status: result.status,
          appointment_id: apt.id,
        });
        out.sent++;
      }
    } catch (err) {
      out.errors.push({
        tenant_id: cfg.tenant_id,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return jsonResponse(200, out);
});
