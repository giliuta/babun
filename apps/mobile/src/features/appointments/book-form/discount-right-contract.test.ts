import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { bookFormSource } from "./source-for-tests";

// СКИДКА ЗАПИСИ — ЧАСТЬ БЛОКА «СУММА». Её ставят только в шторке «Итого», и
// шторку открывает ровно одна дверь — строка «Итого», закрытая правом
// `can.editTotal` («Сумма и услуги записи: Меняет» у сотрудника). Вторая
// дверь без права открыла бы скидку тому, кому её не выдавали.
describe("скидка в записи — по праву «Сумма»", () => {
  const source = bookFormSource();

  test("шторку «Итого» открывает одна дверь, и она закрыта `can.editTotal`", () => {
    const openers = source.match(/setTotalSheetOpen\(true\)/g) ?? [];
    assert.equal(openers.length, 1);
    assert.match(source, /onOpenTotal=\{can\.editTotal \? \(\) => setTotalSheetOpen\(true\) : undefined\}/);
  });

  test("скидку меняет только шторка «Итого»", () => {
    const setters = source.match(/onValueChange: setDiscountValue/g) ?? [];
    assert.equal(setters.length, 1);
    assert.match(source, /<TotalSheet[\s\S]*?onValueChange: setDiscountValue/);
  });
});
