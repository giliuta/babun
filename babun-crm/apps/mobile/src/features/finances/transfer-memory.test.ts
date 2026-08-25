import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { MemoryKVStorage, setStorage } from "@babun/shared/storage";
import {
  loadLastTransferTarget,
  rememberTransferTarget,
} from "./transfer-memory";

describe("память пары «откуда → куда»", () => {
  beforeEach(() => {
    // Свежее хранилище на каждый тест: память — это состояние телефона, и
    // тесты не должны видеть привычки друг друга.
    setStorage(new MemoryKVStorage());
  });

  test("без истории подстановки нет", () => {
    assert.equal(loadLastTransferTarget("acc-cash"), null);
  });

  test("пара запоминается на источник и переживает повторное чтение", () => {
    rememberTransferTarget("acc-cash", "acc-bank");
    assert.equal(loadLastTransferTarget("acc-cash"), "acc-bank");
    // Память ПО ИСТОЧНИКУ: у другого счёта своя привычка.
    assert.equal(loadLastTransferTarget("acc-card"), null);
  });

  test("новая пара затирает старую — привычка одна, а не список", () => {
    rememberTransferTarget("acc-cash", "acc-bank");
    rememberTransferTarget("acc-cash", "acc-card");
    assert.equal(loadLastTransferTarget("acc-cash"), "acc-card");
  });
});
