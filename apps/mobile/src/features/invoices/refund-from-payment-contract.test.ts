import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// «Вернуть» на платеже возвращает деньги С ЭТОГО платежа и его счёта:
// раньше сервер брал самые новые платежи инвойса, и наличные уходили с карты.
const here = dirname(fileURLToPath(import.meta.url));
const read = (f: string) => readFileSync(resolve(here, f), "utf8");

test("номер платежа идёт от строки до сервера", () => {
  assert.match(read("detail/InvoiceDetailScreen.tsx"), /&paymentId=\$\{payment\.id\}/);
  const screen = read("../../../app/invoices/credit-note.tsx");
  assert.match(screen, /paymentId: paymentParam/);
  assert.match(screen, /language: paperLanguage,\s*paymentId,/);
  assert.match(read("../finances/invoices-queries.ts"), /\.\.\.\(input\.paymentId \? \{ p_payment_id: input\.paymentId \} : \{\}\)/);
  assert.match(read("../finances/invoices-queries.ts"), /error\.code === "PGRST202"/);
});
