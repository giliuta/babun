// Webcal / iCalendar feed — «Календарь в телефоне».
//
// GET /functions/v1/calendar-ics/<token>.ics
//
// Без входа ПО ЗАМЫСЛУ: Календарь iPhone, Google и Outlook подписываются по
// адресу и заголовков не шлют (`verify_jwt = false` в config.toml). Секрет —
// сам адрес, поэтому в нём ОТЗЫВНОЙ случайный токен (192 бита,
// `calendar_feed_tokens`), а не user_id (13.10, нашли сессии 007 и 025).
// Раньше ключом был user_id: неотзываемый, и мастер видел UUID владельца в
// `created_by` каждой записи — подставлял его в адрес и забирал рабочий
// календарь компании без входа.
//
// КТО ЧТО ВИДИТ — НЕ ЗДЕСЬ. Строки отдаёт `calendar_feed_events(token)`
// (миграция 20261013130000): живое членство, отзыв, роль и скрытые блоки
// решает база теми же функциями, что у приложения. Эта функция только
// превращает строки в iCalendar. Личные события в ленту не попадают.
//
// Старые адреса babun.app/api/calendar/<user_id>.ics умерли вместе с вебом
// (25.08) — подписчиков на них нет.

import { serviceClient } from "../_shared/service-client.ts";

/** 24 случайных байта hex — форма токена из `calendar_feed_tokens`. */
const TOKEN_RE = /^[0-9a-f]{48}$/;

interface AptRow {
  id: string;
  date: string;
  time_start: string;
  time_end: string;
  status: string | null;
  address: string | null;
  comment: string | null;
}


function notFound(): Response {
  return new Response("Not Found", { status: 404 });
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

// Заголовок события в ленте: заметка записи или «Запись». Заметку, скрытую от
// подписчика правом «Заметка», база уже отдала пустой.
function summarize(apt: AptRow): string {
  return apt.comment || "Запись";
}

function buildIcs(apts: AptRow[]): string {
  const lines: string[] = [];
  lines.push("BEGIN:VCALENDAR");
  lines.push("VERSION:2.0");
  lines.push("PRODID:-//Babun CRM//Calendar//EN");
  lines.push("CALSCALE:GREGORIAN");
  lines.push("METHOD:PUBLISH");
  lines.push("X-WR-CALNAME:Babun");
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

  // Path shape: /functions/v1/calendar-ics/<token>.ics — take the last
  // non-empty segment and strip the .ics suffix Apple/Google append.
  const segments = new URL(req.url).pathname.split("/").filter(Boolean);
  const last = segments[segments.length - 1] ?? "";
  const token = last.replace(/\.ics$/i, "").toLowerCase();
  if (!TOKEN_RE.test(token)) return notFound();

  const sb = serviceClient();
  if (!sb) {
    // Configuration gap, not the caller's fault. 503 so subscribers retry.
    return new Response("Service Unavailable", { status: 503 });
  }

  // Пустой ответ и «нет такого токена» неразличимы снаружи намеренно: на
  // отозванный, чужой и выдуманный адрес — одинаковый 404, перебором ничего
  // не узнать. Живой токен без записей — пустой календарь (200).
  const { data: known, error: tokenErr } = await sb
    .from("calendar_feed_tokens")
    .select("token")
    .eq("token", token)
    .is("revoked_at", null)
    .maybeSingle();
  if (tokenErr) return new Response("Service Unavailable", { status: 503 });
  if (!known) return notFound();

  const { data: rows, error: rowsErr } = await sb.rpc("calendar_feed_events", {
    p_token: token,
  });
  if (rowsErr) return new Response("Service Unavailable", { status: 503 });

  const body = buildIcs((rows ?? []) as AptRow[]);
  return new Response(req.method === "HEAD" ? null : body, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      // Лента личная: общие кэши её держать не должны.
      "Cache-Control": "private, max-age=600",
      "Content-Disposition": "inline; filename=babun.ics",
    },
  });
});
