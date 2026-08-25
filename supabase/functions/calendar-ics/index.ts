// Webcal / iCalendar feed — Edge Function port of
// apps/web/src/app/api/calendar/[user_id]/route.ts (Brief 2 #26).
//
// GET /functions/v1/calendar-ics/<user_id>.ics
//
// Unauthenticated BY DESIGN — the URL itself is the secret (the
// Calendly / Bumpix pattern). `verify_jwt = false` in config.toml, so
// Apple Calendar / Google / Outlook can subscribe without a header.
//
// ⚠️ ЧТО ЗДЕСЬ ЕЩЁ НЕ ЗАКРЫТО (2026-08-26, решение за владельцем).
//   1. Ключ ленты = user_id, он неотзываемый и предсказуемой формы. Правильно —
//      таблица calendar_feed_tokens по образцу master_rating_tokens
//      (20260517_004) плюс строки «Подписаться» / «Отозвать ссылку» в Кабинете.
//      Смена ключа ломает все уже оформленные подписки, поэтому нужен
//      переходный период, а без экрана токен выпускать нечем.
//   2. Роль подписчика не резолвится: мастер получает ленту всего тенанта, а не
//      своих записей. Резолвить роль надо не здесь, а в SECURITY DEFINER RPC
//      (calendar_feed_rows), иначе появится второй источник правды по ролям.
//      Пока роли нет, лента отдаёт только kind='work' — см. фильтр ниже.
//
// ⚠️ EXTERNAL CALLERS. Calendars that already subscribed point at
// https://babun.app/api/calendar/<id>.ics. Deleting the Next route
// silently kills those feeds — no error surfaces to the user, the
// calendar just stops updating. The old URL must 301 here (or keep
// serving) until every subscriber has moved.
//
// PORTING NOTES vs the Next route:
//   * `@babun/shared` is NOT importable in Edge Functions (Deno, no
//     workspace resolution), so the appointment read is inlined. Only
//     the seven columns the feed renders are selected.
//   * The date window is filtered in SQL instead of fetching the whole
//     tenant and filtering in JS. Same result set, bounded payload —
//     the Next version pulled every appointment ever for the tenant.
//   * Output bytes are otherwise identical: same PRODID, same field
//     order, same CRLF joining, same escaping, same floating-time
//     stamps (no Z) so consumers interpret in their own zone.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.0";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface AptRow {
  id: string;
  date: string;
  time_start: string;
  time_end: string;
  status: string | null;
  address: string | null;
  comment: string | null;
}

function serviceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const secretKeysJson = Deno.env.get("SUPABASE_SECRET_KEYS");
  const legacyServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  let serviceKey: string | undefined;
  if (secretKeysJson) {
    try {
      const candidates = Object.values(
        JSON.parse(secretKeysJson) as Record<string, unknown>,
      ).filter(
        (v): v is string => typeof v === "string" && v.length > 20,
      );
      serviceKey =
        candidates.find((v) => v.startsWith("sb_secret_")) ?? candidates[0];
    } catch {
      // fall through to the legacy service-role JWT
    }
  }
  if (!serviceKey) serviceKey = legacyServiceKey || undefined;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function notFound(): Response {
  return new Response("Not Found", { status: 404 });
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/** "YYYYMMDDTHHmmss" — floating local time, no Z, per the Next route. */
function stamp(dateKey: string, hhmm: string): string {
  return `${dateKey.replace(/-/g, "")}T${hhmm.replace(":", "")}00`;
}

function stampNow(): string {
  const d = new Date();
  return (
    d.getUTCFullYear().toString() +
    String(d.getUTCMonth() + 1).padStart(2, "0") +
    String(d.getUTCDate()).padStart(2, "0") +
    "T" +
    String(d.getUTCHours()).padStart(2, "0") +
    String(d.getUTCMinutes()).padStart(2, "0") +
    String(d.getUTCSeconds()).padStart(2, "0") +
    "Z"
  );
}

/** RFC 5545 escaping — backslash, semicolon, comma, newlines. */
function escapeIcs(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

// Заголовок события в ленте. Ветки под личное (kind 'event' / 'personal') здесь
// НЕТ намеренно: выборка ниже жёстко фильтрует kind='work', до этой функции
// личное не доезжает вовсе — ветка была недостижимой и врала о поведении ленты.
// Вернуть её надо будет вместе с резолвом роли подписчика (пункт 2 в шапке):
// тогда меняются оба места сразу — и фильтр запроса, и заголовок.
function summarize(apt: AptRow): string {
  return apt.comment || "Запись";
}

function buildIcs(apts: AptRow[], userId: string): string {
  const lines: string[] = [];
  lines.push("BEGIN:VCALENDAR");
  lines.push("VERSION:2.0");
  lines.push("PRODID:-//Babun CRM//Calendar//EN");
  lines.push("CALSCALE:GREGORIAN");
  lines.push("METHOD:PUBLISH");
  lines.push(`X-WR-CALNAME:Babun (${userId.slice(0, 8)})`);
  lines.push("X-WR-TIMEZONE:Europe/Nicosia");

  for (const apt of apts) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${apt.id}@babun.app`);
    lines.push(`DTSTAMP:${stampNow()}`);
    lines.push(`DTSTART:${stamp(apt.date, apt.time_start)}`);
    lines.push(`DTEND:${stamp(apt.date, apt.time_end)}`);
    lines.push(`SUMMARY:${escapeIcs(summarize(apt))}`);
    if (apt.address) lines.push(`LOCATION:${escapeIcs(apt.address)}`);
    if (apt.comment) lines.push(`DESCRIPTION:${escapeIcs(apt.comment)}`);
    lines.push(
      `STATUS:${apt.status === "completed" ? "CONFIRMED" : "TENTATIVE"}`,
    );
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

Deno.serve(async (req: Request) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // Path shape: /functions/v1/calendar-ics/<user_id>.ics — take the last
  // non-empty segment and strip the .ics suffix Apple/Google append.
  const segments = new URL(req.url).pathname.split("/").filter(Boolean);
  const last = segments[segments.length - 1] ?? "";
  const id = last.replace(/\.ics$/i, "");
  if (!UUID_RE.test(id)) return notFound();

  const sb = serviceClient();
  if (!sb) {
    // Configuration gap, not the caller's fault. 503 so subscribers retry.
    return new Response("Service Unavailable", { status: 503 });
  }

  // Which tenant does this user belong to? service-role bypasses RLS by
  // design — this URL is the user's own subscription secret.
  //
  // Порядок «самое старое членство» повторяет фолбэк внутри
  // public.current_tenant_id() (20260430_008_team_roles.sql — ссылаемся по
  // имени функции, номера строк там уже уезжали), чтобы лента и политики
  // выбирали один и тот же тенант. maybeSingle() здесь была багом: у человека
  // в двух тенантах она возвращает ошибку, и подписка молча получала 503.
  const { data: members, error: memberErr } = await sb
    .from("tenant_members")
    .select("tenant_id")
    .eq("user_id", id)
    .order("joined_at", { ascending: true })
    .order("tenant_id", { ascending: true })
    .limit(1);
  if (memberErr) return new Response("Service Unavailable", { status: 503 });
  const member = members?.[0];
  if (!member?.tenant_id) return notFound();

  // Window: 30 days back … 180 days ahead (same bounds as the Next route).
  const now = new Date();
  const back = new Date(now);
  back.setDate(back.getDate() - 30);
  const ahead = new Date(now);
  ahead.setDate(ahead.getDate() + 180);

  const { data: rows, error: aptErr } = await sb
    .from("appointments")
    // `kind` не выбираем: он нужен только как фильтр ниже, в тело ленты не идёт.
    .select("id, date, time_start, time_end, status, address, comment")
    .eq("tenant_id", member.tenant_id)
    // ЛИЧНОЕ НЕ ОТДАЁМ. kind in ('event','personal') — это приватные события
    // конкретного человека, ради которых написана 20260508_001_personal_event_rls.
    // Лента ходит под service_role, RLS её не сдерживает, а фильтра по
    // ролям здесь нет вовсе — значит по ссылке любого мастера утекал ВЕСЬ
    // календарь тенанта вместе с чужой личной жизнью. Пока роль не резолвится
    // на сервере, отдаём только рабочие записи.
    .eq("kind", "work")
    .neq("status", "cancelled")
    .gte("date", ymd(back))
    .lte("date", ymd(ahead))
    .order("date", { ascending: true });
  if (aptErr) return new Response("Service Unavailable", { status: 503 });

  const body = buildIcs((rows ?? []) as AptRow[], id);
  return new Response(req.method === "HEAD" ? null : body, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "public, max-age=600",
      "Content-Disposition": `inline; filename=babun-${id}.ics`,
    },
  });
});
