import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  TEAM_ACCOUNT_SEEDS,
  planAccountSeeds,
  type ExistingSeedTarget,
} from "./account-seeds";

const account = (
  over: Partial<ExistingSeedTarget> & { name: string },
): ExistingSeedTarget => ({
  brigade_id: "team-a",
  position: 0,
  ...over,
});

describe("автосоздание счетов", () => {
  test("новая команда получает «Наличные» и «Карту» с позициями 0 и 1", () => {
    const plan = planAccountSeeds({
      seeds: TEAM_ACCOUNT_SEEDS,
      existing: [],
      brigadeId: "team-a",
    });
    assert.deepEqual(plan, [
      { name: "Наличные", kind: "cash", position: 0 },
      { name: "Карта", kind: "card", position: 1 },
    ]);
  });

  // СЧЕТА КОМПАНИИ БОЛЬШЕ НЕ ЗАВОДЯТСЯ (владелец 2026-08-15): их набор
  // («Наличные», «Расчётный счёт», «Карта») существовал ради снесённого общего
  // счёта, а регистрация не знает ни одной команды и приписать деньги некому.
  // Счета приезжают с первой командой — это тест выше.

  test("повтор после обрыва дозаводит недостающее, а не дублирует", () => {
    const plan = planAccountSeeds({
      seeds: TEAM_ACCOUNT_SEEDS,
      existing: [account({ name: "наличные", position: 0 })],
      brigadeId: "team-a",
    });
    assert.deepEqual(plan, [{ name: "Карта", kind: "card", position: 1 }]);
  });

  test("закрытый счёт тоже занимает имя", () => {
    const plan = planAccountSeeds({
      seeds: TEAM_ACCOUNT_SEEDS,
      // Закрытые счета приходят в том же списке — фильтра по is_active тут
      // нет сознательно: имя занято и закрытым счётом.
      existing: [account({ name: "Наличные ", position: 3 })],
      brigadeId: "team-a",
    });
    assert.deepEqual(plan, [{ name: "Карта", kind: "card", position: 4 }]);
  });

  test("счета соседней команды и счёт без владельца созданию не мешают", () => {
    const plan = planAccountSeeds({
      seeds: TEAM_ACCOUNT_SEEDS,
      existing: [
        account({ name: "Наличные", brigade_id: "team-b", position: 7 }),
        // Счёт без команды — наследие снесённого общего счёта: у него своё,
        // пустое пространство нумерации, и группе команды он не мешает.
        account({ name: "Карта", brigade_id: null, position: 9 }),
      ],
      brigadeId: "team-a",
    });
    assert.deepEqual(plan, [
      { name: "Наличные", kind: "cash", position: 0 },
      { name: "Карта", kind: "card", position: 1 },
    ]);
  });
});
