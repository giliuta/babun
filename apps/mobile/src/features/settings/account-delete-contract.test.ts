import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// УДАЛЕНИЕ АККАУНТА (аудит 04.10, требование App Store 5.1.1(v)).
// Аккаунт, где человек — единственный владелец, удаляется каскадом вместе с
// записью о подписке; без отмены в Stripe тариф списывался бы каждый месяц
// после удаления. И в вебе запрос не доходил до функции: клиент шлёт
// `x-babun-tenant`, а CORS его не пропускал.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const FN = readFileSync(path.join(ROOT, "supabase/functions/account-delete/index.ts"), "utf8");
const WEBHOOK = readFileSync(path.join(ROOT, "supabase/functions/stripe-webhook/index.ts"), "utf8");

test("подписки Stripe отменяются раньше первого необратимого шага", () => {
  const cancel = FN.indexOf("await cancelSoleOwnedSubscriptions(service, user.id)");
  const softDelete = FN.indexOf("service.auth.admin.deleteUser(\n    user.id,\n    true,");
  assert.ok(cancel > 0, "удаление аккаунта не отменяет подписки");
  assert.ok(softDelete > cancel, "подписка отменяется после блокировки аккаунта");
  assert.match(FN, /method: "DELETE", headers/);
  assert.match(FN, /status=all&limit=100/);
});

test("отбор аккаунтов — как у серверной чистки: только где человек единственный владелец", () => {
  assert.match(FN, /\.eq\("role", "owner"\)/);
  assert.match(FN, /o\.tenant_id === id && o\.user_id !== userId/);
});

test("CORS пропускает заголовок компании", () => {
  assert.match(FN, /"authorization, content-type, x-client-info, apikey, x-babun-tenant"/);
});

// Событие об отменённой подписке приходит, когда аккаунта уже нет: запись
// журнала с его id падала на внешнем ключе, вебхук отвечал 500, и Stripe
// повторял событие трое суток.
test("вебхук Stripe не падает на событии стёртого аккаунта", () => {
  assert.match(WEBHOOK, /if \(typeof clientRef === "string" && clientRef\) return liveTenant\(sbs, clientRef\);/);
  assert.match(WEBHOOK, /if \(typeof metaTenant === "string" && metaTenant\) return liveTenant\(sbs, metaTenant\);/);
});
