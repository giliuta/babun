import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// ПЕРЕВОД, ДОЛГ И КАТЕГОРИЯ НА СЕРВЕРЕ (20261016180000). Удаление календаря
// оставляло «живой» запрос перевода к стёртому счёту, долг гасился операцией
// чужой компании или не той стороны денег, категория с историей уезжала в
// другую команду.

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.resolve(here, "../../../../supabase/migrations");
const FILE = "20261016180000_finance_calendar_debt_category_guards.sql";
const sql = readFileSync(path.join(MIGRATIONS, FILE), "utf8").replace(/\s+/g, " ");

test("удаление календаря не трогает ногу перевода на живом счёте, а запрос чистит по любому счёту", () => {
  // Нога на живом счёте — его настоящие деньги: стерев её, мы списали бы
  // сданную выручку с остатка банка.
  assert.doesNotMatch(sql, /or transfer_group_id in \(/);
  assert.match(sql, /delete from public\.finance_transactions where tenant_id = v_tenant and account_id = any \(v_accounts\);/);
  assert.match(sql, /or from_account_id = any \(v_accounts\) or to_account_id = any \(v_accounts\)/);
});

test("платёж по долгу — той же компании и той же стороны денег", () => {
  assert.match(sql, /if v_debt\.tenant_id is distinct from new\.tenant_id then raise exception 'Долг не найден'/);
  assert.match(sql, /if \(v_debt\.direction = 'incoming'\) is distinct from \(new\.type = 'income'\)/);
  // Смена типа или компании — тоже повод проверить.
  assert.match(sql, /and new\.type is not distinct from old\.type and new\.tenant_id is not distinct from old\.tenant_id/);
  assert.match(sql, /before insert or update of amount, debt_id, type, tenant_id on public\.finance_transactions/);
});

test("команда используемой категории заморожена", () => {
  assert.match(sql, /or new\.team_id is distinct from old\.team_id \) and \(/);
});

test("эти три функции позже не переопределены", () => {
  const later = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql") && f > FILE)
    .filter((f) =>
      /function public\.(delete_calendar|guard_debt_payment_total|guard_finance_category_history_delete)\(/.test(
        readFileSync(path.join(MIGRATIONS, f), "utf8"),
      ),
    );
  assert.deepEqual(later, []);
});
