import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  recordFilled,
  resolveRecordColor,
  resolveRecordSituation,
} from "./record-color";

const FULL = { client: true, object: true, services: true };
const PALETTE = {
  noClient: "#8E8E93",
  noObject: "#FF9500",
  noServices: "#FFCC00",
};
const COBALT = "#2F6BFF";

describe("resolveRecordColor", () => {
  test("выбранный рукой цвет сильнее всех правил", () => {
    assert.equal(
      resolveRecordColor({
        override: "#AF52DE",
        filled: { client: false, object: false, services: false },
        base: "#34C759",
        palette: PALETTE,
        fallback: COBALT,
      }),
      "#AF52DE",
    );
  });

  test("заполненная запись берёт обычный цвет", () => {
    assert.equal(
      resolveRecordColor({
        filled: FULL,
        base: "#34C759",
        palette: PALETTE,
        fallback: COBALT,
      }),
      "#34C759",
    );
  });

  test("первая дыра сверху вниз побеждает следующие", () => {
    assert.equal(
      resolveRecordColor({
        filled: { client: false, object: false, services: false },
        base: "#34C759",
        palette: PALETTE,
        fallback: COBALT,
      }),
      PALETTE.noClient,
    );
    assert.equal(
      resolveRecordColor({
        filled: { client: true, object: false, services: false },
        base: "#34C759",
        palette: PALETTE,
        fallback: COBALT,
      }),
      PALETTE.noObject,
    );
    assert.equal(
      resolveRecordColor({
        filled: { client: true, object: true, services: false },
        base: "#34C759",
        palette: PALETTE,
        fallback: COBALT,
      }),
      PALETTE.noServices,
    );
  });

  test("ситуация без своего цвета пропускается, а не гасит остальные", () => {
    assert.equal(
      resolveRecordColor({
        filled: { client: false, object: false, services: true },
        base: "#34C759",
        palette: { noClient: null, noObject: "#FF9500" },
        fallback: COBALT,
      }),
      "#FF9500",
    );
  });

  test("выключенный блок бизнеса не считается дырой", () => {
    // У мастера маникюра объекта нет вовсе — это норма, а не пропуск.
    assert.equal(
      resolveRecordColor({
        filled: { client: true, object: false, services: true },
        base: "#34C759",
        palette: PALETTE,
        active: ["noClient", "noServices"],
        fallback: COBALT,
      }),
      "#34C759",
    );
  });

  test("нет ни правила, ни обычного цвета — кобальт продукта", () => {
    assert.equal(
      resolveRecordColor({
        filled: FULL,
        base: null,
        palette: {},
        fallback: COBALT,
      }),
      COBALT,
    );
    assert.equal(
      resolveRecordColor({
        filled: { client: false, object: true, services: true },
        base: "   ",
        palette: { noClient: "  " },
        fallback: COBALT,
      }),
      COBALT,
    );
  });
});

describe("recordFilled", () => {
  test("объект закрыт вписанным адресом, не только ссылкой", () => {
    // Разовый выезд по звонку в справочник не заводят — и красить его дырой
    // значит врать.
    assert.equal(recordFilled({ location_id: "loc-1" }).object, true);
    assert.equal(recordFilled({ address: "Лимассол, 1" }).object, true);
    assert.equal(recordFilled({ address: "  " }).object, false);
    assert.equal(recordFilled({ address: "ул" }).object, false);
    assert.equal(recordFilled({}).object, false);
  });

  test("услуги закрыты снимком строк или вписанной рукой суммой", () => {
    assert.equal(recordFilled({ service_ids: ["s1"] }).services, true);
    assert.equal(recordFilled({ services: [{}] }).services, true);
    assert.equal(recordFilled({ custom_total: true }).services, true);
    assert.equal(recordFilled({ total_amount: 150 }).services, true);
    assert.equal(recordFilled({ total_amount: "150" }).services, true);
    assert.equal(recordFilled({ total_amount: 0 }).services, false);
    assert.equal(recordFilled({}).services, false);
  });

  test("клиент — только по ссылке", () => {
    assert.equal(recordFilled({ client_id: "c1" }).client, true);
    assert.equal(recordFilled({}).client, false);
  });
});

describe("resolveRecordSituation", () => {
  test("называет ту же дыру, что покрасила запись", () => {
    const palette = { noClient: "#8E8E93", noObject: "#FF9500", noServices: "#FFCC00" };
    assert.equal(
      resolveRecordSituation({
        filled: { client: true, object: false, services: false },
        palette,
      }),
      "noObject",
    );
  });

  test("у записи с выбранным рукой цветом ситуации нет", () => {
    assert.equal(
      resolveRecordSituation({
        override: "#AF52DE",
        filled: { client: false, object: false, services: false },
        palette: { noClient: "#8E8E93" },
      }),
      null,
    );
  });

  test("ситуация без цвета не называется", () => {
    assert.equal(
      resolveRecordSituation({
        filled: { client: false, object: true, services: true },
        palette: { noClient: null },
      }),
      null,
    );
  });
});
