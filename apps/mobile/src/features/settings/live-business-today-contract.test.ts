import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// ФОРМА ДОКУМЕНТА ЗАМЕЧАЕТ ПОЛНОЧЬ САМА. Хук тянет react-native и под
// раннером не поднимается — проверка идёт по исходнику.

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(here, rel), "utf8");

test("день сверяется по таймеру и при возврате из фона", () => {
  const hook = read("live-business-today.ts");
  assert.match(hook, /setInterval\(check, 60_000\)/);
  assert.match(hook, /AppState\.addEventListener\("change"/);
  assert.match(hook, /clearInterval\(timer\);\s*sub\.remove\(\);/);
});

test("новый инвойс, кредит-нота, чек и возврат берут живой день", () => {
  for (const screen of [
    "../../../app/invoices/new.tsx",
    "../../../app/invoices/credit-note.tsx",
    "../../../app/documents/receipt-new.tsx",
    "../../../app/documents/receipt-refund.tsx",
  ]) {
    assert.match(read(screen), /const businessToday = useLiveBusinessToday\(\);/, screen);
  }
});
