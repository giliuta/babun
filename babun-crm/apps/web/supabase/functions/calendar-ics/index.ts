// Webcal / iCalendar feed — Edge Function port of
// apps/web/src/app/api/calendar/[user_id]/route.ts (Brief 2 #26).
//
// GET /functions/v1/calendar-ics/<user_id>.ics
//
// Unauthenticated BY DESIGN — the URL itself is the secret (the
// Calendly / Bumpix pattern). `verify_jwt = false` in config.toml, so
// Apple Calendar / Google / Outlook can subscribe without a header.
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
//     the eight columns the feed renders are selected.
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
  kind: string | null;
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

function summarize(apt: AptRow): string {
  if (apt.kind === "event" || apt.kind === "personal") {
    return apt.comment || "Событие";
  }
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
  const { data: member, error: memberErr } = await sb
    .from("tenant_members")
    .select("tenant_id")
    .eq("user_id", id)
    .maybeSingle();
  if (memberErr) return new Response("Service Unavailable", { status: 503 });
  if (!member?.tenant_id) return notFound();

  // Window: 30 days back … 180 days ahead (same bounds as the Next route).
  const now = new Date();
  const back = new Date(now);
  back.setDate(back.getDate() - 30);
  const ahead = new Date(now);
  ahead.setDate(ahead.getDate() + 180);

  const { data: rows, error: aptErr } = await sb
    .from("appointments")
    .select("id, date, time_start, time_end, status, address, comment, kind")
    .eq("tenant_id", member.tenant_id)
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
