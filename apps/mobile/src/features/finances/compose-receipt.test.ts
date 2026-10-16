import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { TransactionDraft } from "@babun/shared/db/repositories/finance-transactions";
import { composeReceipt } from "./compose-receipt";

// ЧЕК С НУЛЯ — ДВА ШАГА: приход, потом бумага. Если бумага не вышла, человек
// жмёт «Выписать» ещё раз — и второй приход в журнал лечь не должен.

/** Журнал как в базе: первичный ключ — `request_id`, если он есть. */
function fakeLedger() {
  const rows = new Map<string, TransactionDraft>();
  let serial = 0;
  return {
    rows,
    insert: async (draft: TransactionDraft) => {
      const id = draft.request_id ?? `tx-${++serial}`;
      if (!rows.has(id)) rows.set(id, draft);
      return { id };
    },
  };
}

const draft: TransactionDraft = { type: "income", amount: 50, client_id: "c-1", account_id: "a-1" };

describe("чек с нуля: повтор после ошибки", () => {
  test("вторая попытка не пишет второй приход и выписывает чек на первый", async () => {
    const ledger = fakeLedger();
    const issuedFor: string[] = [];
    let fail = true;
    const issue = async ({ transactionId }: { transactionId: string }) => {
      issuedFor.push(transactionId);
      if (fail) throw new Error("сеть моргнула");
      return { id: "rc-1", number: "RC-1" };
    };
    const input = { draft, lines: [], requestId: "req-1" };

    await assert.rejects(composeReceipt(input, { insert: ledger.insert, issue }));
    fail = false;
    const receipt = await composeReceipt(input, { insert: ledger.insert, issue });

    assert.equal(receipt.number, "RC-1");
    assert.equal(ledger.rows.size, 1, "приход задвоился");
    assert.deepEqual(issuedFor, ["req-1", "req-1"]);
  });

  test("экран держит один id попытки и меняет его только после выписки", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const screen = readFileSync(resolve(here, "../../../app/documents/receipt-new.tsx"), "utf8");
    assert.match(screen, /useState\(\(\) => randomUuid\(\)\)/);
    assert.match(screen, /compose\.mutateAsync\(\{[\s\S]{0,200}requestId: composeRequestId/);
    assert.match(screen, /setComposeRequestId\(randomUuid\(\)\)/);
  });
});
