import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));

// ПРОВОДКА ФОРМЫ ОПЕРАЦИИ — по исходнику: логика уже под своими тестами, здесь
// стережётся, что экран её действительно зовёт.
const read = (file: string) => readFileSync(resolve(here, file), "utf8");

describe("request_id операции привязан к содержимому", () => {
  test("вставка берёт id по полям формы, а не из состояния, не меняющегося при правке", () => {
    const save = read("use-operation-save.ts");
    assert.match(save, /s\.requestIds\.idFor\(/);
    assert.match(save, /s\.requestIds\.done\(\)/);
    assert.ok(!/s\.requestId\b/.test(save));
  });

  test("форма не держит id в useState", () => {
    assert.ok(!/useState\(randomUuid\)/.test(read("use-operation-draft.ts")));
  });

  test("возврат в витрине операции — тоже по содержимому", () => {
    const popup = readFileSync(resolve(here, "../TransactionPopup.tsx"), "utf8");
    assert.match(popup, /refundIds\.idFor\(/);
    assert.ok(!/useState\(randomUuid\)/.test(popup));
  });
});

describe("сырые сетевые ошибки не показываются как есть", () => {
  test("сохранение операции говорит словами через saveErrorText", () => {
    const save = read("use-operation-save.ts");
    assert.match(save, /saveErrorText\(/);
    assert.ok(!/notify\("Ошибка", \(e as Error\)\.message\)/.test(save));
  });
});

describe("закрытие свайпом знает про налог", () => {
  test("ключ набранного включает режим и ставку VAT с двух сторон", () => {
    assert.match(read("use-operation-close.ts"), /vatDirtyKey\(draft\.vatMode, vatRate\)/);
    assert.match(read("use-operation-draft.ts"), /vat: vatDirtyKey\(txVat/);
  });
});

describe("строка VAT не зависит от набранной ставки", () => {
  test("видимость считает общее правило с учётом открытой строки", () => {
    assert.match(read("use-operation-vat.ts"), /vatControlsVisible\(\{ isOwner, rate: vat\.rate, shown: vatShown \}\)/);
  });

  test("поле ставки не пишет в память разобранное «пусто»", () => {
    const looks = readFileSync(resolve(here, "../../appointments/VatLooks.tsx"), "utf8");
    assert.match(looks, /parseVatRate\(text\)/);
    assert.match(looks, /if \(next != null && next !== vat\.rate\)/);
  });
});

describe("ставка VAT 0 (16.10)", () => {
  test("ставка 0 из формы уходит явным «без налога», а не режимом без снимка", () => {
    const save = read("use-operation-save.ts");
    assert.match(save, /namedMode && namedMode !== "none" && !\(s\.opVatRate > 0\) && \(!s\.isEdit \|\| s\.vatRetouched\)\s*\? "none"/);
  });

  test("запомненный ноль не гасит ставку команды", () => {
    const vat = read("use-operation-vat.ts");
    assert.match(vat, /rate: rememberedVat\.rate > 0 \? rememberedVat\.rate : settingsVat\.rate/);
  });

  test("форма сверяет замок чека и долг по сумме с налогом", () => {
    const sheet = read("../OperationSheet.tsx");
    assert.match(sheet, /useReceiptLock\(\{ visible, transaction, amountCents: grossCents, accountId, date \}\)/);
    assert.match(sheet, /\n\s+grossCents,\n/);
  });
});

test("оплата долга открывается в команде самого долга", () => {
  const sheets = read("../home/HomeSheets.tsx");
  assert.match(sheets, /defaultTeamId=\{debtPayment\?\.teamId \?\? \(scope === NO_TEAM \? null : scope\)\}/);
  assert.match(read("../DebtSheet.tsx"), /teamId: debt\.team_id,/);
});
