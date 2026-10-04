import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  defaultOperationVatMode,
  vatModeForDraft,
  vatSnapshotForDraft,
} from "./operation-vat";
import { applyTxVat } from "@babun/shared/local/finance/vat";

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
  test("расход по умолчанию не «Плюс VAT»: сумма с чека — то, что ушло", () => {
    assert.equal(defaultOperationVatMode("exclusive", "expense"), "inclusive");
    assert.equal(defaultOperationVatMode("exclusive", "income"), "exclusive");
    assert.equal(defaultOperationVatMode("inclusive", "expense"), "inclusive");
    assert.equal(defaultOperationVatMode("none", "expense"), "none");
  });
});

describe("снимок налога операции (30.09)", () => {
  test("новая операция с налогом везёт ставку формы и налог той же разбивки", () => {
    // Память «Итого» — 5 %, а настройка компании могла бы сказать 19 % или
    // «выключено»: сервер обязан получить то, что человек видел под клавишами.
    const breakdown = applyTxVat(100, "exclusive", 5);
    assert.deepEqual(
      vatSnapshotForDraft({ mode: "exclusive", rate: 5, vat: breakdown.vat, fresh: true }),
      { vat_rate: 5, vat_amount: breakdown.vat },
    );
    // Налог выделен из брутто так же, как у `fill_transaction_vat`.
    assert.equal(breakdown.gross, 105);
    assert.equal(breakdown.vat, 5);
  });

  test("без налога, без ставки или без названного режима — молчим", () => {
    assert.equal(vatSnapshotForDraft({ mode: "none", rate: 19, vat: 0, fresh: true }), null);
    assert.equal(vatSnapshotForDraft({ mode: "inclusive", rate: 0, vat: 0, fresh: true }), null);
    assert.equal(vatSnapshotForDraft({ mode: undefined, rate: 19, vat: 3.19, fresh: true }), null);
  });

  test("правка без нового нажатия клавиши ставку строки не трогает", () => {
    assert.equal(
      vatSnapshotForDraft({ mode: "inclusive", rate: 19, vat: 3.19, fresh: false }),
      null,
    );
  });
});
