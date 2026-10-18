import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

// ПОВТОР ПОСЛЕ ПОТЕРЯННОГО ОТВЕТА ВЕДЁТ НА УЖЕ СОЗДАННЫЙ ДОКУМЕНТ. Сервер на
// повтор id отдаёт прежний документ; правки между попытками роняли
// контрольное чтение на каждом нажатии, а уход с формы и новая попытка
// рождали второй счёт или вторую ноту.

const here = dirname(fileURLToPath(import.meta.url));
const page = (name: string) =>
  readFileSync(resolve(here, `../../../app/invoices/${name}`), "utf8");

describe("повтор выставления", () => {
  test("инвойс: второй заход того же id спрашивает «уже есть?» и ведёт на документ", () => {
    const src = page("new.tsx");
    assert.match(src, /const repeat = sentRef\.current;\s*sentRef\.current = true;/);
    assert.match(src, /issue\.mutateAsync\(\{ \.\.\.value, request_id: requestId, repeat \}\)/);
    assert.match(src, /instanceof InvoiceAlreadyIssuedError/);
    assert.match(src, /router\.replace\(`\/invoices\/\$\{issueError\.invoice\.id\}`/);
  });

  test("кредит-нота: уже выписанная этим id открывается, а не выписывается снова", () => {
    const src = page("credit-note.tsx");
    assert.match(src, /if \(sentRef\.current\) \{\s*const already = await getInvoice\(supabase, requestId\);/);
    assert.match(src, /already\?\.kind === "credit_note" && already\.credit_note_of_id === row\.id/);
    assert.match(src, /issued\.current = already\.id;/);
  });
});
