import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// ПЛАТЁЖ ИНВОЙСА И СВОДКА `payment`. Приложение считает полученное по заявке
// как большее из суммы `payments` и сводки `payment` (getPaidAmount). Если
// триггер платежа инвойса меняет только список, сводка после возврата
// остаётся завышенной и долг на экране гаснет. Тест держит то, что последняя
// миграция, определяющая или правящая триггер, ставит сводку из того же
// списка через `appointment_payment_mirror`.

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.resolve(here, "../../../../supabase/migrations");
const FN = "settle_appointment_from_invoice_payment";
const FIX = "20261018192000_invoice_settle_rebuilds_payment_mirror.sql";

function read(file: string): string {
  return readFileSync(path.join(MIGRATIONS, file), "utf8");
}

// Определяет функцию целиком или правит её тело заменой по якорям.
function touchesFunction(sql: string): boolean {
  return (
    new RegExp(`create (or replace )?function public\\.${FN}\\(`, "i").test(sql) ||
    new RegExp(`'public\\.${FN}\\(\\)'::regprocedure[\\s\\S]*execute`, "i").test(sql)
  );
}

function lastDefiner(): string {
  const defining = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .filter((f) => touchesFunction(read(f)));
  return defining[defining.length - 1];
}

test("последняя правка триггера платежа инвойса — не раньше фикса сводки", () => {
  const last = lastDefiner();
  assert.ok(last >= FIX, `${FN} переопределён миграцией ${last} раньше фикса`);
});

test("триггер ставит список и сводку из одного выражения", () => {
  const sql = read(lastDefiner());
  assert.match(sql, /\(payments, payment\) = \(/);
  assert.match(sql, /select v\.p, public\.appointment_payment_mirror\(v\.p\)/);
});

test("правка по якорям: якорь должен встречаться ровно один раз", () => {
  const sql = read(FIX);
  assert.match(sql, /не найден ровно один раз/);
  assert.match(sql, /set local lock_timeout = '5s';/);
  assert.match(sql, /do \$guard\$/);
});

test("досчёт старых строк — только заявки с платежами инвойса", () => {
  const sql = read(FIX);
  assert.match(sql, /set payment = public\.appointment_payment_mirror\(a\.payments\)/);
  assert.match(sql, /e ->> 'id' like 'pay-inv-%'/);
  assert.match(sql, /'invoice_payment', stale\.id, stale\.tenant_id/);
});
