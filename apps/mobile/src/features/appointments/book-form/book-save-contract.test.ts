import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// НОВАЯ ЗАПИСЬ С ОПЛАТОЙ: двойной «Создать» не шлёт оплату дважды, а без
// сети оплата не теряется молча — «Создать» с оплатой ждёт связи.

const here = dirname(fileURLToPath(import.meta.url));
const save = readFileSync(resolve(here, "book-save.ts"), "utf8");

test("второй тап «Создать» в том же кадре не уходит вторым сохранением", () => {
  assert.match(save, /const save = async \(\) => \{\s*if \(savingRef\.current\) return;/);
  assert.match(save, /savingRef\.current = true;/);
  assert.match(save, /finally \{\s*savingRef\.current = false;\s*\}/);
});

test("оплата новой записи — один номер попытки на жизнь формы", () => {
  assert.match(save, /requestId: paymentRequestIdRef\.current,/);
  assert.doesNotMatch(save, /requestId: randomUuid\(\),/);
});

test("без сети «Создать» с оплатой не отправляет запись", () => {
  assert.match(save, /if \(!isEdit && pendingPayment && kind === "work" && !isOnline\(\)\) \{/);
});

test("колокольчик правки загорается по ответу, а не до него (CAL-40)", () => {
  // Запрет уведомлений правило не хранит — колокольчик показывает сохранённое.
  assert.match(save, /\.then\(\(res\) => \{\s*setSelfReminderRule\(getSelfReminder\(editing\.id\)\);/);
  assert.match(save, /void Linking\.openSettings\(\);/);
});
