import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// «ВЫСТАВИТЬ ИНВОЙС» БЕЗ ДОКУМЕНТОВ В ТАРИФЕ — СЕРЫМ (владелец 1.10:
// «закончилась подписка — всё видно, новое серым»). Значок не пропадает,
// тап поднимает плашку тарифа; выписанный документ открывается как раньше.

const here = dirname(fileURLToPath(import.meta.url));
const block = () => readFileSync(resolve(here, "PaymentBlock.tsx"), "utf8");

describe("инвойс в оплате и тариф", () => {
  test("значок есть при остатке независимо от тарифа", () => {
    assert.match(block(), /const canInvoice = documentsOn && \(Boolean\(invoice\) \|\| outstanding > 0\);/);
  });
  test("без документов в тарифе — серый и зовёт плашку, выписанный — открывается", () => {
    assert.match(block(), /const invoiceTariffLocked = !invoice && !canUseDocuments;/);
    assert.match(block(), /dimmed=\{invoiceTariffLocked\}/);
    assert.match(block(), /onPress=\{invoiceTariffLocked \? tariffNudge : handleInvoice\}/);
  });
});
