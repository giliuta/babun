import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isKnownChange, isOwnWrite, markOwnWrite } from "./own-writes";

describe("эхо своей правки не перечитывает календарь", () => {
  const cached = [{ id: "a1", updated_at: "2026-09-30T08:55:08.016962+00:00" }];

  test("та же версия в кэше — эхо, даже в другом формате времени", () => {
    assert.equal(
      isKnownChange({ event: "UPDATE", id: "a1", updatedAt: "2026-09-30 08:55:08.016962+00" }, cached),
      true,
    );
  });

  test("другая версия — чужая правка, перечитать", () => {
    assert.equal(
      isKnownChange({ event: "UPDATE", id: "a1", updatedAt: "2026-09-30T09:00:00+00:00" }, cached),
      false,
    );
  });

  test("удаление и событие без id — всегда перечитать", () => {
    assert.equal(isKnownChange({ event: "DELETE", id: "a1", updatedAt: null }, cached), false);
    assert.equal(isKnownChange({ event: "UPDATE", id: null, updatedAt: null }, cached), false);
    assert.equal(isKnownChange(undefined, cached), false);
  });

  test("правка в пути — эхо, пока не истёк срок", () => {
    markOwnWrite("b2", 1000);
    const now = Date.now();
    assert.equal(isOwnWrite("b2", now), true);
    assert.equal(isKnownChange({ event: "UPDATE", id: "b2", updatedAt: "x" }, [], now), true);
    assert.equal(isOwnWrite("b2", now + 1001), false);
  });
});
