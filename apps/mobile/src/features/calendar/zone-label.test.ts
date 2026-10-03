import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ZONE_GROUPS } from "@babun/shared/local/timezones";
import { zoneGroupIndexOf, zoneToApply } from "./zone-label";

// «ПРИМЕНИТЬ» БЕЗ ВЫБОРА НЕ ПЕРЕПИСЫВАЕТ ПОЯС (аудит шестерёнки 03.10).
describe("зона, которую пишет лист часового пояса", () => {
  const cyprus = "Asia/Nicosia";
  const own = zoneGroupIndexOf(cyprus);

  test("своя группа на барабане — своя зона остаётся", () => {
    assert.notEqual(ZONE_GROUPS[own].zone, cyprus);
    assert.equal(zoneToApply(cyprus, null, own), cyprus);
  });

  test("другая группа — её представитель", () => {
    const other = own === 0 ? 1 : 0;
    assert.equal(zoneToApply(cyprus, null, other), ZONE_GROUPS[other].zone);
  });

  test("город из поиска важнее барабана", () => {
    assert.equal(zoneToApply(cyprus, "Europe/Athens", own), "Europe/Athens");
  });
});
