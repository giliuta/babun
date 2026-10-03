import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// ЧЕК, ВЫПИСАННЫЙ ДО ИНВОЙСА, ВИДЕН НА СТРАНИЦЕ ИНВОЙСА (аудит 03.10).
// `issue_invoice` по доходу (p_link_to_tx_id) чек этого дохода к инвойсу не
// привязывает, а страница искала чеки только по `invoice_id`: старого чека
// не было видно, «Выписать чек» стоял навсегда, сервер на нажатие отдавал
// старый чек, а тост говорил «выписан».

const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string) => readFileSync(resolve(here, path), "utf8");

describe("чеки страницы инвойса", () => {
  test("ищутся и по инвойсу, и по его платежам", () => {
    assert.match(
      read("receipts-queries.ts"),
      /q = q\.or\(`invoice_id\.eq\.\$\{invoiceId\},transaction_id\.in\.\(\$\{transactionIds\.join\(","\)\}\)`\);/,
    );
  });

  test("страница отдаёт платежи инвойса", () => {
    assert.match(
      read("../../../app/invoices/[id].tsx"),
      /useReceipts\(\{ invoiceId: id, transactionIds: incomeIds, enabled: !!id \}\)/,
    );
  });
});
