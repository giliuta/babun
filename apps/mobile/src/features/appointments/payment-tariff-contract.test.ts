import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { readModuleSource } from "@/lib/module-source";

// «ВЫСТАВИТЬ ИНВОЙС» БЕЗ ДОКУМЕНТОВ В ТАРИФЕ — СЕРЫМ (закончилась подписка — всё видно, новое серым). Значок не пропадает,
// тап поднимает плашку тарифа; выписанный документ открывается как раньше.

const here = dirname(fileURLToPath(import.meta.url));
// The block is `PaymentBlock.tsx` plus its `payment-block/` folder.
const block = () => readModuleSource(resolve(here, "PaymentBlock.tsx"), resolve(here, "payment-block"));

describe("инвойс в оплате и тариф", () => {
  test("значок есть при остатке независимо от тарифа", () => {
    // И после оплаты, если по деньгам записи инвойса ещё нет.
    // Выписать — с «Документы: Выставляет», открыть выписанный — с «Видит».
    assert.match(
      block(),
      /const canInvoice =\s*documentsOn &&\s*documentsLevel !== "none" &&\s*\(Boolean\(invoice\) \|\| \(docWrite && \(outstanding > 0 \|\| Boolean\(receiptState\.invoiceNext\)\)\)\);/,
    );
  });
  test("без документов в тарифе — серый и зовёт плашку, выписанный — открывается", () => {
    assert.match(block(), /const invoiceTariffLocked = !invoice && !canUseDocuments;/);
    assert.match(block(), /dimmed=\{invoiceTariffLocked\}/);
    assert.match(block(), /onPress=\{invoiceTariffLocked \? tariffNudge : handleInvoice\}/);
  });
  test("без тарифа записи клиентов — плитки, «Часть суммы» и снятие серые и зовут плашку", () => {
    const src = block();
    assert.match(src, /const bookingInPlan = usePlanAllows\("book-clients"\);/);
    // Право денег — у записи «Оплата», у записи с инвойсом — «Документы».
    assert.match(src, /const moneyRight = invoicePay\.open \? docWrite : canTakeMoney;/);
    assert.match(src, /const acceptsMoney = outstanding > 0 && !billUnsaved && !clientUnsaved && !slotChange && !visitCancelled && moneyRight && bookingInPlan;/);
    // Все три входа в деньги: тап по плитке, снятие с оплаченной, «Часть суммы».
    assert.equal((src.match(/if \(!bookingInPlan\) \{\s*tariffNudge\(\);\s*return;\s*\}/g) ?? []).length, 3);
    assert.match(src, /dimmed=\{!bookingInPlan\}/);
  });
});
