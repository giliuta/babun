import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { operationStartType } from "./start-type";
import type { OperationType } from "./types";

const here = dirname(fileURLToPath(import.meta.url));
const only = (side: OperationType) => (type: OperationType) => type === side;

describe("сторона новой операции", () => {
  test("обычная операция — сторона, которую человек может завести", () => {
    assert.equal(
      operationStartType({ defaultType: "expense", debtPayment: false, typeWritable: only("income") }),
      "income",
    );
    assert.equal(
      operationStartType({ defaultType: "income", debtPayment: false, typeWritable: () => true }),
      "income",
    );
  });

  test("оплата долга «мне должны» у партнёра «только расходы» — всё равно доход (F-09)", () => {
    assert.equal(
      operationStartType({ defaultType: "income", debtPayment: true, typeWritable: only("expense") }),
      "income",
    );
  });

  test("оплата долга «я должен» у партнёра «только доходы» — всё равно расход", () => {
    assert.equal(
      operationStartType({ defaultType: "expense", debtPayment: true, typeWritable: only("income") }),
      "expense",
    );
  });

  test("форма берёт сторону отсюда", () => {
    const draft = readFileSync(resolve(here, "use-operation-draft.ts"), "utf8");
    assert.match(draft, /operationStartType\(\{ defaultType, debtPayment: !!debtPayment, typeWritable \}\)/);
  });
});
