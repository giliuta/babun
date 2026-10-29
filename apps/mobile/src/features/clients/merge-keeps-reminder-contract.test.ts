import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

// СЛИЯНИЕ ДУБЛЕЙ НЕ ТЕРЯЕТ «НАПОМНИТЬ», ЯЗЫК И ПЕРВЫЙ КОНТАКТ (С9).
// Сервер переносит три поля, которых нет в патче приложения; телефон снимает
// уведомление дубля (иначе пуш открыл бы удалённую карточку) и ставит
// перенесённое на основную.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const NAME = "20261028201000_merge_clients_keeps_reminder_language_first_contact.sql";
const file = [path.join(ROOT, "supabase/migrations", NAME), path.join(ROOT, "supabase/parked", NAME)].find((p) =>
  existsSync(p),
);
const SQL = file ? readFileSync(file, "utf8") : "";
const HOOK = readFileSync(path.join(ROOT, "apps/mobile/src/features/clients/use-merge-duplicate.ts"), "utf8");

describe("слияние дублей: напоминание, язык, первый контакт", () => {
  test("сервер переносит поля после патча и снимает дату у дубля", () => {
    assert.ok(SQL, "нет миграции");
    assert.match(SQL, /pg_get_functiondef\('public\.merge_clients\(uuid, uuid, jsonb, uuid\[\], jsonb\)'::regprocedure\)/);
    assert.match(SQL, /then dup\.language/);
    assert.match(SQL, /dup\.first_contact_date < c\.first_contact_date/);
    assert.match(SQL, /reminder_at = coalesce\(c\.reminder_at, dup\.reminder_at\)/);
    assert.match(SQL, /reminder_at = null\\n'/);
    // Якорь не найден — миграция падает, а не молча ничего не меняет.
    assert.equal((SQL.match(/raise exception 'merge_clients: якорь/g) ?? []).length, 2);
  });

  test("телефон снимает уведомление дубля и ставит его основной, если у неё нет своего", () => {
    const after = HOOK.slice(HOOK.indexOf("await mergeClientsOnServer("));
    assert.match(after, /void dropClientReminder\(dupRow\.id\);/);
    assert.match(after, /if \(!fresh\.reminder_at && dupRow\.reminder_at\) \{\s*void syncClientReminder\(/);
    assert.ok(after.indexOf("dropClientReminder") < after.indexOf('toast("Объединили")'));
  });
});
