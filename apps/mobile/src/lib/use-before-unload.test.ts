import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// Каждая форма, которая спрашивает перед уходом внутри приложения
// (`usePreventRemove`), спрашивает и перед F5 / закрытием вкладки на вебе —
// иначе перезагрузка молча теряла набранное.
const MOBILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FORMS = [
  "src/features/appointments/book-form/use-leave-guard.ts",
  "src/features/clients/card/use-client-card.ts",
  "app/documents/receipt-new.tsx",
  "app/invoices/new.tsx",
];

test("формы с вопросом перед уходом спрашивают и перед закрытием вкладки", () => {
  for (const file of FORMS) {
    const src = readFileSync(path.join(MOBILE, file), "utf8");
    assert.match(src, /usePreventRemove\(/, `${file}: защиты ухода больше нет — обнови список`);
    assert.match(src, /useBeforeUnloadWhileDirty\(/, `${file}: F5 на вебе молча теряет форму`);
  }
});
