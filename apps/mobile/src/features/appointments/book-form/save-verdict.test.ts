import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { saveVerdict, type SaveVerdictInput } from "./save-verdict";

const ready = (over: Partial<SaveVerdictInput> = {}): SaveVerdictInput => ({
  kind: "work",
  timeStart: "10:00",
  timeEnd: "11:00",
  failedReference: undefined,
  referencesPending: false,
  teamId: "t1",
  hasValidTeam: true,
  clientId: "c1",
  hasService: true,
  workSelectionValid: true,
  bookingBusy: false,
  archivedRecord: false,
  ...over,
});

describe("saveVerdict", () => {
  test("a complete record can be saved", () => {
    assert.equal(saveVerdict(ready()).canSave, true);
  });

  test("the hint names the earliest missing thing, in filling order", () => {
    const hint = (over: Partial<SaveVerdictInput>) => saveVerdict(ready(over)).missingHint;
    assert.equal(hint({ clientId: null, hasService: false }), "Выберите клиента");
    assert.equal(hint({ hasService: false, hasValidTeam: false }), "Выберите услугу");
    assert.equal(hint({ hasValidTeam: false }), "Выберите команду");
    assert.equal(
      hint({ hasValidTeam: false, archivedRecord: true }),
      "Календарь в архиве — запись только для просмотра",
    );
    assert.equal(hint({ workSelectionValid: false }), "Проверьте услуги и мастера для этой команды");
  });

  test("busy, failed and loading states speak before the record's own gaps", () => {
    const hint = (over: Partial<SaveVerdictInput>) => saveVerdict(ready(over)).missingHint;
    assert.equal(hint({ bookingBusy: true, clientId: null }), "Сохраняем…");
    assert.equal(
      hint({ failedReference: { label: "клиентов" }, clientId: null }),
      "Не удалось загрузить клиентов",
    );
    assert.equal(hint({ referencesPending: true }), "Загружаем данные…");
    assert.equal(
      hint({ timeEnd: "10:00", clientId: null }),
      "Время окончания должно быть позже начала",
    );
  });

  test("time, failures and pending loads block saving", () => {
    assert.equal(saveVerdict(ready({ timeEnd: "09:00" })).canSave, false);
    assert.equal(saveVerdict(ready({ failedReference: { label: "команды" } })).canSave, false);
    assert.equal(saveVerdict(ready({ referencesPending: true })).canSave, false);
  });

  test("an event needs no client or service; a personal one needs no team", () => {
    const ev = (over: Partial<SaveVerdictInput>) =>
      saveVerdict(ready({ kind: "event", clientId: null, hasService: false, ...over }));
    assert.equal(ev({}).canSave, true);
    assert.equal(ev({ teamId: null, hasValidTeam: false }).canSave, true);
    assert.equal(ev({ hasValidTeam: false }).canSave, false);
    assert.equal(ev({ hasValidTeam: false }).missingHint, "Выберите доступный календарь");
  });
});
