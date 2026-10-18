import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

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
