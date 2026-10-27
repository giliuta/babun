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

// ВОЗВРАТ ПЕРЕПЛАТЫ И ИТОГ — ОДНОЙ ТРАНЗАКЦИЕЙ (№6, dat/M-03): два вызова
// оставляли возврат без нового итога, когда срывалось сохранение.
const repo = readFileSync(
  resolve(here, "../../../../../../packages/shared/src/db/repositories/appointment-payments.ts"),
  "utf8",
);
const mutations = readFileSync(resolve(here, "../payment-mutations.ts"), "utf8");

test("итог ниже полученного — один вызов возврата с сохранением, не два (№6)", () => {
  assert.match(
    save,
    /await refundOverpayment\.mutateAsync\(\{[\s\S]*?requestId: overpayRequestRef\.current,\s*patch,[\s\S]*?expectedUpdatedAt,\s*\}\);\s*\} else if \(Object\.keys\(patch\)\.length > 0\) \{\s*await updateMut\.mutateAsync/,
  );
  assert.match(repo, /supabase\.rpc\("refund_overpayment_and_save", \{[\s\S]*?p_patch: input\.patch,[\s\S]*?p_expected_updated_at/);
  assert.doesNotMatch(repo + mutations + save, /refund_appointment_overpayment"|refundAppointmentOverpayment\(/);
  // Тело — то же, что у обычного сохранения: мастер — своя дверь, остальные — колонки.
  assert.match(mutations, /memberPatch\(vars\.patch, vars\.kind\)[\s\S]*?appointmentToUpdate\(vars\.patch\)/);
});

test("оплата записи шлёт часы телефона в момент отправки (dat/M-07)", () => {
  // В самом вызове, а не в аргументах тапа: очередь мастера отправляет позже.
  assert.match(
    repo,
    /rpc\("record_appointment_payment", \{[\s\S]*?p_sent_at: new Date\(\)\.toISOString\(\),\s*\}\);/,
  );
});
