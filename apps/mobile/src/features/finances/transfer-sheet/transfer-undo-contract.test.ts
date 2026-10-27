import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

// Отмена перевода на счёт, бывший в минусе. Сервер (`delete_account_transfer`)
// раньше требовал «на счёте назначения не меньше суммы перевода» — счёт с
// минусом до перевода не проходил никогда. Порог теперь — ниже нуля И ниже
// остатка до перевода: потраченные деньги перевода по-прежнему держат отмену.
describe("transfer undo migration contract", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // До наката файл лежит в `supabase/parked/`, после — в `migrations/`.
  const file = "20261027231700_transfer_undo_negative_destination.sql";
  const repo = path.resolve(here, "../../../../../..");
  const found = ["supabase/migrations", "supabase/parked"]
    .map((dir) => path.join(repo, dir, file))
    .find((p) => existsSync(p));

  test("threshold is min(0, balance before the transfer), not the transfer amount", () => {
    assert.ok(found, `нет ${file}`);
    const sql = readFileSync(found, "utf8");
    assert.match(sql, /if destination_balance - request_row\.amount < least\(0, \(/);
    assert.match(sql, /filter \(where tx\.created_at < request_row\.created_at\)/);
  });

  test("edits the live body by anchor and keeps the translated refusal text", () => {
    assert.ok(found, `нет ${file}`);
    const sql = readFileSync(found, "utf8");
    assert.match(sql, /якорь проверки остатка не найден/);
    // Текст отказа — ключ словаря языков (`server-keys.json`): менять нельзя.
    const refusals = sql.match(/'На счёте назначения уже недостаточно средств для отмены перевода'/g) ?? [];
    assert.equal(refusals.length, 2);
    assert.match(sql, /has_function_privilege\('anon', 'public\.delete_account_transfer\(uuid\)', 'execute'\)/);
  });
});
