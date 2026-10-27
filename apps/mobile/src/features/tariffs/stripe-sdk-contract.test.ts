import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

// STRIPE В ВЕБХУКЕ — ПАКЕТ NPM, А НЕ ESM.SH. Сборка esm.sh тянула
// node-совместимость Deno std, и та на каждое событие писала в логи «event
// loop error: Deno.core.runMicrotasks() is not supported»: ответы 200, но
// настоящий сбой вебхука в таком шуме не отличить. Пакет из npm по условию
// `deno` отдаёт сборку для воркеров (fetch, Web Crypto).

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const WEBHOOK = readFileSync(path.join(ROOT, "supabase/functions/stripe-webhook/index.ts"), "utf8");

describe("Stripe в вебхуке", () => {
  test("пакет npm той же версии, без esm.sh", () => {
    assert.match(WEBHOOK, /import Stripe from "npm:stripe@17\.7\.0";/);
    assert.doesNotMatch(WEBHOOK, /esm\.sh\/stripe/);
  });

  test("подпись — через Web Crypto явно, запросы — через fetch", () => {
    assert.match(WEBHOOK, /constructEventAsync\([\s\S]{0,120}Stripe\.createSubtleCryptoProvider\(\)/);
    assert.match(WEBHOOK, /Stripe\.createFetchHttpClient\(\)/);
  });
});
