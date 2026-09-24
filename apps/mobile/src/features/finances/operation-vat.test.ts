import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { vatModeForDraft } from "./operation-vat";

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
