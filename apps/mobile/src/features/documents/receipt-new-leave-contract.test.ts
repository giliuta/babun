import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// ЗАПОЛНЕННЫЙ ЧЕК НЕ ИСЧЕЗАЕТ ПО ОДНОМУ ТАПУ — как черновик инвойса
// (`app/invoices/new.tsx`): спрашивает сама навигация, на любой уход («‹»,
// свайп от края, системное «назад»), теми же словами. Выписанный чек уходит
// без вопроса.
const here = dirname(fileURLToPath(import.meta.url));
const screen = readFileSync(resolve(here, "../../../app/documents/receipt-new.tsx"), "utf8");
const invoice = readFileSync(resolve(here, "../../../app/invoices/new.tsx"), "utf8");

describe("черновик чека при уходе", () => {
  test("уход спрашивает навигация, когда человек что-то правил", () => {
    assert.match(screen, /usePreventRemove\(dirty,/);
    // Грязным черновик делают только правки человека — не заполнение из оплаты.
    assert.match(screen, /onChange=\{edit\}/);
  });

  test("вопрос — теми же словами, что у инвойса", () => {
    // «Уйти», а не «Выйти»: «Выйти» — ключ выхода из аккаунта, на английском «Sign out».
    for (const phrase of ["\"Черновик не сохранён\"", "\"Уйти и потерять заполненное?\"", "confirmLabel: \"Уйти\""]) {
      assert.ok(invoice.includes(phrase), `у инвойса нет ${phrase}`);
      assert.ok(screen.includes(phrase), `у чека нет ${phrase}`);
    }
  });

  test("выписанный чек уходит без вопроса", () => {
    assert.match(screen, /leavingRef\.current = true;\s*if \(editing\) router\.back\(\)/);
  });
});
