import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  defaultOperationVatMode,
  vatConsequenceLine,
  vatModeForDraft,
} from "./operation-vat";

// Здесь решается, ляжет ли операция компании с НДС без налога. Сервер уважает
// явное «Без НДС» сильнее настроек, поэтому форма обязана молчать, когда
// настройку налога она не прочитала: пустая колонка значит «считай сам».

const owner = { canReadSettings: true, settingsKnown: true };

describe("режим НДС в черновике операции", () => {
  test("сотрудник не называет режим: ни в новой операции, ни в правке", () => {
    assert.equal(
      vatModeForDraft({
        mode: "none",
        chosen: false,
        canReadSettings: false,
        settingsKnown: false,
      }),
      undefined,
    );
    // Правка взводит `chosen` гидрацией — но у сотрудника это не выбор, а
    // снимок строки, который сервер и так знает.
    assert.equal(
      vatModeForDraft({
        mode: "inclusive",
        chosen: true,
        canReadSettings: false,
        settingsKnown: true,
      }),
      undefined,
    );
  });

  test("владелец с доехавшими настройками отправляет режим формы", () => {
    assert.equal(vatModeForDraft({ mode: "inclusive", chosen: false, ...owner }), "inclusive");
    assert.equal(vatModeForDraft({ mode: "none", chosen: true, ...owner }), "none");
    assert.equal(vatModeForDraft({ mode: "exclusive", chosen: true, ...owner }), "exclusive");
  });

  test("настройки ещё не доехали — режим не называем", () => {
    assert.equal(
      vatModeForDraft({
        mode: "none",
        chosen: false,
        canReadSettings: true,
        settingsKnown: false,
      }),
      undefined,
    );
  });

  test("нажатая клавиша сильнее недоехавших настроек", () => {
    assert.equal(
      vatModeForDraft({
        mode: "exclusive",
        chosen: true,
        canReadSettings: true,
        settingsKnown: false,
      }),
      "exclusive",
    );
  });
});

describe("VAT по направлению денег (аудит 2026-09-29)", () => {
  const fmt = (n: number) => `€${n}`;
  const b = { gross: 1.19, vat: 0.19, net: 1 };

  test("расход по умолчанию не «Плюс VAT»: сумма с чека — то, что ушло", () => {
    assert.equal(defaultOperationVatMode("exclusive", "expense"), "inclusive");
    assert.equal(defaultOperationVatMode("exclusive", "income"), "exclusive");
    assert.equal(defaultOperationVatMode("inclusive", "expense"), "inclusive");
    assert.equal(defaultOperationVatMode("none", "expense"), "none");
  });

  test("подпись у расхода — «со счёта уйдёт», у дохода — «на счёт придёт»", () => {
    assert.equal(vatConsequenceLine("expense", "exclusive", b, fmt), "Со счёта уйдёт €1.19 · налог €0.19");
    assert.equal(vatConsequenceLine("income", "exclusive", b, fmt), "На счёт придёт €1.19 · налог €0.19");
    assert.equal(vatConsequenceLine("expense", "inclusive", b, fmt), "Из них налог €0.19 · без налога €1");
    assert.equal(vatConsequenceLine("income", "inclusive", b, fmt), "Из них налог €0.19 · вам остаётся €1");
    assert.equal(vatConsequenceLine("income", "none", b, fmt), null);
  });
});
