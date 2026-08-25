import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  createTransferRequestIds,
  transferIntentKey,
  type TransferIntentFields,
} from "./transfer-intent";

function fields(
  patch: Partial<TransferIntentFields> = {},
): TransferIntentFields {
  return {
    fromAccountId: "acc-from",
    toAccountId: "acc-to",
    amountCents: 64_000,
    occurredOn: "2026-08-16",
    note: "",
    ...patch,
  };
}

/** Предсказуемые id вместо uuid: тесту важно РАЗЛИЧИЕ, а не случайность. */
function counter(): () => string {
  let n = 0;
  return () => `id-${++n}`;
}

describe("transferIntentKey — в ключе всё, что можно поправить перед повтором", () => {
  test("каждое поле меняет ключ", () => {
    const base = transferIntentKey(fields());
    assert.notEqual(transferIntentKey(fields({ fromAccountId: "x" })), base);
    assert.notEqual(transferIntentKey(fields({ toAccountId: "x" })), base);
    assert.notEqual(transferIntentKey(fields({ amountCents: 100 })), base);
    // Смена «Когда» после потерянного ответа — другое намерение: старый ключ
    // упирался бы в серверное «уже использован с другими данными».
    assert.notEqual(
      transferIntentKey(fields({ occurredOn: "2026-08-15" })),
      base,
    );
    assert.notEqual(transferIntentKey(fields({ note: "на бензин" })), base);
  });

  test("пробелы вокруг комментария намерения не меняют", () => {
    assert.equal(
      transferIntentKey(fields({ note: "  на бензин " })),
      transferIntentKey(fields({ note: "на бензин" })),
    );
  });
});

describe("createTransferRequestIds — повтор дедупится, правка честно новая", () => {
  test("повтор без правок возвращает тот же id", () => {
    const intent = createTransferRequestIds(counter());
    assert.equal(intent.idFor(fields()), "id-1");
    assert.equal(intent.idFor(fields()), "id-1");
  });

  test("правка любого поля выдаёт новый id", () => {
    const intent = createTransferRequestIds(counter());
    assert.equal(intent.idFor(fields()), "id-1");
    assert.equal(intent.idFor(fields({ occurredOn: "2026-08-15" })), "id-2");
    assert.equal(intent.idFor(fields({ note: "долг" })), "id-3");
  });

  test("после done() те же поля — уже новое намерение", () => {
    const intent = createTransferRequestIds(counter());
    assert.equal(intent.idFor(fields()), "id-1");
    intent.done();
    // Второй такой же перевод — легитимный: «ещё раз €640 туда же».
    assert.equal(intent.idFor(fields()), "id-2");
  });
});
