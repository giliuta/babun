import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { eventSpan, resolveTimeZone, utcStamp, wallTimeToInstant } from "./ics-time.ts";

// ЛЕНТА КАЛЕНДАРЯ — ПО ОТЗЫВНОМУ ТОКЕНУ, НЕ ПО user_id (13.10). Функция без
// входа (`verify_jwt = false`), поэтому адрес и есть секрет: user_id мастер
// видел в `created_by` каждой записи и забирал календарь компании.

const here = dirname(fileURLToPath(import.meta.url));
const fn = readFileSync(resolve(here, "index.ts"), "utf8");
const sql = readFileSync(resolve(here, "../../migrations/20261013130000_calendar_feed_tokens.sql"), "utf8");

test("функция принимает только токен и берёт строки из базы, а не сама", () => {
  assert.match(fn, /const TOKEN_RE = \/\^\[0-9a-f\]\{48\}\$\/;/);
  assert.doesNotMatch(fn, /UUID_RE|tenant_members|\.from\("appointments"\)/);
  assert.match(fn, /sb\.rpc\("calendar_feed_events", \{\s*p_token: token,/);
  assert.match(fn, /\.is\("revoked_at", null\)/);
  assert.match(fn, /"Cache-Control": "private, max-age=600"/);
});

test("строки ленты: только сервисный ключ, мастер — как в его приложении", () => {
  assert.match(sql, /revoke all on function public\.calendar_feed_events\(text\) from public, anon, authenticated;/);
  assert.match(sql, /revoke all on table public\.calendar_feed_tokens from public, anon, authenticated;/);
  assert.match(sql, /list_master_appointments_safe\(v_page \* 1000, 1000\)/);
  assert.match(sql, /references public\.tenant_members \(tenant_id, user_id\) on delete cascade/);
  assert.match(sql, /a\.kind = 'work'/);
});

// ВРЕМЯ СОБЫТИЙ — В UTC ИЗ ЗОНЫ КОМПАНИИ. «Плавающее» время с подсказкой
// X-WR-TIMEZONE часть календарей читала в своей зоне — визит съезжал.

test("лента пишет DTSTART/DTEND в UTC из зоны компании, а не плавающее время", () => {
  assert.match(fn, /eventSpan\(apt\.date, apt\.time_start, apt\.time_end, timeZone\)/);
  assert.match(fn, /\.from\("calendar_settings"\)\s*\.select\("timezone"\)/);
  assert.doesNotMatch(fn, /X-WR-TIMEZONE:Europe\/Nicosia/);
  assert.doesNotMatch(fn, /function stamp\(/);
});

test("Никосия: летом UTC+3, зимой UTC+2", () => {
  assert.equal(utcStamp(wallTimeToInstant("2026-07-15", "10:00", "Europe/Nicosia")), "20260715T070000Z");
  assert.equal(utcStamp(wallTimeToInstant("2026-01-15", "10:00", "Europe/Nicosia")), "20260115T080000Z");
});

test("другая зона компании даёт другой момент", () => {
  assert.equal(utcStamp(wallTimeToInstant("2026-07-15", "10:00", "Europe/Minsk")), "20260715T070000Z");
  assert.equal(utcStamp(wallTimeToInstant("2026-07-15", "10:00", "America/New_York")), "20260715T140000Z");
  assert.equal(utcStamp(wallTimeToInstant("2026-07-15", "10:00", "Asia/Kolkata")), "20260715T043000Z");
});

test("переходы часов: весенний пропуск — вперёд, осенний повтор — ранний момент", () => {
  // 29.03.2026 в Никосии 03:00 → 04:00.
  assert.equal(utcStamp(wallTimeToInstant("2026-03-29", "03:30", "Europe/Nicosia")), "20260329T013000Z");
  // 25.10.2026 в Никосии 04:00 → 03:00: 03:30 бывает дважды.
  assert.equal(utcStamp(wallTimeToInstant("2026-10-25", "03:30", "Europe/Nicosia")), "20261025T003000Z");
});

test("конец 24:00, запись через полночь и мусор", () => {
  assert.deepEqual(eventSpan("2026-07-15", "22:00", "24:00", "Europe/Nicosia"), {
    start: "20260715T190000Z",
    end: "20260715T210000Z",
  });
  assert.deepEqual(eventSpan("2026-07-15", "23:00", "01:00", "Europe/Nicosia"), {
    start: "20260715T200000Z",
    end: "20260715T220000Z",
  });
  assert.equal(eventSpan("2026-07-15", "ab", "11:00", "Europe/Nicosia"), null);
  assert.equal(eventSpan("2026-02-30", "10:00", "11:00", "Europe/Nicosia"), null);
});

test("пустая или неизвестная зона — Europe/Nicosia", () => {
  assert.equal(resolveTimeZone(null), "Europe/Nicosia");
  assert.equal(resolveTimeZone("  "), "Europe/Nicosia");
  assert.equal(resolveTimeZone("Mars/Olympus"), "Europe/Nicosia");
  assert.equal(resolveTimeZone("Europe/Minsk"), "Europe/Minsk");
});
