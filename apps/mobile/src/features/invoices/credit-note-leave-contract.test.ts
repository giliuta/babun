import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// КРЕДИТ-НОТА И ВОЗВРАТ ПО ЧЕКУ НЕ ТЕРЯЮТ СУММУ И ПРИЧИНУ МОЛЧА: уход
// спрашивает сама навигация, теми же словами, что черновик инвойса;
// выписанный документ уходит без вопроса.
const here = dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(resolve(here, "../../..", file), "utf8");
const screens = {
  "кредит-нота": read("app/invoices/credit-note.tsx"),
  "возврат по чеку": read("app/documents/receipt-refund.tsx"),
};
const invoice = read("app/invoices/new.tsx");

describe("уход с заполненной формы документа", () => {
  for (const [name, screen] of Object.entries(screens)) {
    test(`${name}: спрашивает навигация, теми же словами, что инвойс`, () => {
      assert.match(screen, /usePreventRemove\(dirty,/);
      assert.match(screen, /reason\.trim\(\) !== ""/);
      for (const phrase of ["\"Черновик не сохранён\"", "\"Уйти и потерять заполненное?\"", "confirmLabel: \"Уйти\""]) {
        assert.ok(invoice.includes(phrase), `у инвойса нет ${phrase}`);
        assert.ok(screen.includes(phrase), `у экрана «${name}» нет ${phrase}`);
      }
    });

    test(`${name}: выписанный документ открывается без вопроса`, () => {
      assert.match(screen, /leavingRef\.current = true;\s*router\.replace\(`\/invoices\/\$\{issued\.current\}`/);
    });
  }
});
