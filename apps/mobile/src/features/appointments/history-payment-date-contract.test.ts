import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// ДЕНЬГИ ВОССТАНОВЛЕННОЙ ЗАЯВКИ И ДАТА ВВОДА ИСТОРИИ. Две миграции меняют
// функции денег заявки точечной заменой в боевом теле, поэтому в репозитории
// нет буквального определения с этими правками. Сторож: если позже кто-то
// перепишет такую функцию целиком, его тело обязано сохранить правку —
// иначе восстановление отменённой заявки или дата ввода истории молча
// откатятся.

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(here, "../../../../../supabase/migrations");
const RESTORE = "20261016120000_restore_cancelled_refunded_appointment.sql";
const HISTORY = "20261016120100_appointment_history_payment_date.sql";

function definitionPattern(fn: string): RegExp {
  return new RegExp(
    String.raw`create\s+(?:or\s+replace\s+)?function\s+public\.${fn}\s*\([\s\S]*?\bas\s+(\$\w*\$)([\s\S]*?)\1`,
    "gi",
  );
}

type Definition = { file: string; body: string };

/** Literal bodies of the function in migrations sorted after `after`. */
function definitionsAfter(fn: string, after: string): Definition[] {
  const found: Definition[] = [];
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql") && name > after)
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    for (const match of sql.matchAll(definitionPattern(fn))) {
      found.push({ file, body: match[2] ?? "" });
    }
  }
  return found;
}

const restore = readFileSync(join(MIGRATIONS_DIR, RESTORE), "utf8");
const history = readFileSync(join(MIGRATIONS_DIR, HISTORY), "utf8");

describe("restore of a cancelled appointment whose money was refunded", () => {
  test("the restore migration carries the branch and the prepayment fix", () => {
    assert.match(restore, /По заявке остались невозвращённые деньги; сначала верните их/);
    assert.match(restore, /new\.prepayments := '\[\]'::jsonb;/);
    assert.match(restore, /public\.record_appointment_payment\(uuid,uuid,numeric,uuid,text,timestamp with time zone,boolean\)/);
  });

  test("a later full rewrite of the guard keeps the restore branch", () => {
    for (const { file, body } of definitionsAfter("protect_paid_appointment_finance", RESTORE)) {
      assert.match(body, /По заявке остались невозвращённые деньги/, file);
      assert.match(body, /new\.prepayments := '\[\]'::jsonb;/, file);
    }
  });

  test("a later full rewrite of the payment door counts settlement net of refunds", () => {
    for (const { file, body } of definitionsAfter("record_appointment_payment", RESTORE)) {
      assert.match(body, /refund\.refund_of_id = income\.id[\s\S]*into has_settlement/, file);
    }
  });
});

describe("back-dated history entry puts money on the visit date", () => {
  const dependants = [
    "reconcile_appointment_finance",
    "cancel_appointment_payment",
    "refund_appointment_overpayment",
  ];

  test("the history migration defines the helper and patches every dependant", () => {
    assert.match(history, /create or replace function public\.appointment_history_entry_date\(p_appointment_id uuid\)/);
    assert.match(history, /revoke all on function public\.appointment_history_entry_date\(uuid\) from public, anon, authenticated;/);
    for (const fn of dependants) {
      assert.match(history, new RegExp(String.raw`'public\.${fn}\(`), fn);
    }
  });

  test("a later full rewrite of a dependant keeps calling the helper", () => {
    for (const fn of dependants) {
      for (const { file, body } of definitionsAfter(fn, HISTORY)) {
        assert.match(body, /appointment_history_entry_date\(/, `${fn} in ${file}`);
      }
    }
  });
});
