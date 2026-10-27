// push_activity — ПУШ О ДЕЛАХ КОМАНДЫ НА ТЕЛЕФОН (iPhone и Android через Expo Push).
//
// Решает база (миграция 20261027162300_mobile_push): КОМУ сказать о строке
// журнала `change_log` — по правам календаря и выбору на экране
// «Уведомления». Триггер `zz_push_activity` зовёт функцию одним
// `net.http_post` с заголовком `x-dispatch-secret` из `edge_cron_secrets`
// (имя «push_activity»); JWT здесь не принимается.
//
// Функция только пишет текст на языке каждого телефона (`render.ts`), шлёт
// его в Expo Push и забывает токены, которых больше нет
// (`DeviceNotRegistered`). Правила сборки — в `handler.ts`, под `bun test`.
//
// Секреты: EXPO_ACCESS_TOKEN — необязателен (нужен, только если в Expo
// включена «Enhanced security for push notifications»). Ключи APNs и FCM
// живут не здесь, а в Expo (`eas credentials`) — без них Expo вернёт ошибку
// в ответе, и пуш просто не придёт.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.110.0";
import { serviceClient } from "../_shared/service-client.ts";
import { constantTimeEqual, json } from "../_shared/http.ts";
import { handlePushActivity, type ExpoMessage, type ExpoTicket, type PushDeps } from "./handler.ts";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const DEVICE_FRESH_MS = 60 * 24 * 60 * 60 * 1000;

async function authorized(sb: SupabaseClient, request: Request): Promise<boolean> {
  const supplied = request.headers.get("x-dispatch-secret") ?? "";
  if (!supplied) return false;
  const { data, error } = await sb
    .from("edge_cron_secrets")
    .select("secret")
    .eq("name", "push_activity")
    .single();
  return !error && typeof data?.secret === "string" && constantTimeEqual(supplied, data.secret);
}

function deps(sb: SupabaseClient): PushDeps {
  return {
    async loadLog(id) {
      const { data } = await sb
        .from("change_log")
        .select("id, tenant_id, team_id, entity, entity_id, action, label, meta")
        .eq("id", id)
        .maybeSingle();
      return data ?? null;
    },
    async loadAppointment(tenantId, id) {
      const { data } = await sb
        .from("appointments")
        .select("id, date, time_start, city, client_id, team_id")
        .eq("tenant_id", tenantId)
        .eq("id", id)
        .maybeSingle();
      return data ?? null;
    },
    async loadIncomeAppointmentId(tenantId, id) {
      const { data } = await sb
        .from("finance_transactions")
        .select("appointment_id")
        .eq("tenant_id", tenantId)
        .eq("id", id)
        .maybeSingle();
      return typeof data?.appointment_id === "string" ? data.appointment_id : null;
    },
    async loadClientName(tenantId, id) {
      const { data } = await sb
        .from("clients")
        .select("full_name")
        .eq("tenant_id", tenantId)
        .eq("id", id)
        .maybeSingle();
      return typeof data?.full_name === "string" ? data.full_name : null;
    },
    async loadTeam(tenantId, id) {
      const { data } = await sb
        .from("teams")
        .select("name, timezone")
        .eq("tenant_id", tenantId)
        .eq("id", id)
        .maybeSingle();
      return data ?? null;
    },
    async loadOwners(tenantId, userIds) {
      const { data } = await sb
        .from("tenant_members")
        .select("user_id")
        .eq("tenant_id", tenantId)
        .eq("role", "owner")
        .in("user_id", userIds);
      return new Set((data ?? []).map((row: { user_id: string }) => row.user_id));
    },
    async loadCurrency(tenantId) {
      const { data } = await sb.from("tenants").select("currency").eq("id", tenantId).maybeSingle();
      return typeof data?.currency === "string" && /^[A-Z]{3}$/.test(data.currency) ? data.currency : "EUR";
    },
    async loadDevices(userIds) {
      const { data } = await sb
        .from("push_devices")
        .select("token, user_id, locale")
        .in("user_id", userIds)
        .gt("last_seen_at", new Date(Date.now() - DEVICE_FRESH_MS).toISOString());
      return data ?? [];
    },
    async sendExpo(messages: ExpoMessage[]): Promise<ExpoTicket[]> {
      const token = Deno.env.get("EXPO_ACCESS_TOKEN");
      const response = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          accept: "application/json",
          "accept-encoding": "gzip, deflate",
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(messages),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !Array.isArray(payload?.data)) {
        console.error("expo push rejected", response.status, JSON.stringify(payload?.errors ?? payload));
        throw new Error(`expo ${response.status}`);
      }
      for (const ticket of payload.data as ExpoTicket[]) {
        if (ticket.status === "error") console.warn("expo ticket error", ticket.details?.error, ticket.message);
      }
      return payload.data as ExpoTicket[];
    },
    async dropTokens(tokens) {
      await sb.from("push_devices").delete().in("token", tokens);
    },
    now: () => new Date(),
  };
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
  const sb = serviceClient();
  if (!sb) return json(503, { error: "service_role_unavailable" });
  if (!(await authorized(sb, request))) return json(401, { error: "unauthorized" });

  const raw = await request.json().catch(() => null);
  const result = await handlePushActivity(raw, deps(sb));
  if (!result) return json(400, { error: "bad_request" });
  console.log("push_activity", JSON.stringify(result));
  return json(200, { ok: true, ...result });
});
