import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { composeCalendarChips, type ChipSourceCalendar } from "./calendar-chips";

const AIRFIX = "2bc7907e-b149-44a9-92ff-a5e73403031c";
const GILIUTA = "11365a87-bef9-4f6c-a030-b15083fe646b";

const yd = (isActive: boolean): ChipSourceCalendar => ({
  tenantId: AIRFIX, tenantName: "AirFix LTD", teamId: "team-yd",
  teamName: "Y&D", teamColor: null, isActive,
});
const k1 = (isActive: boolean): ChipSourceCalendar => ({
  tenantId: GILIUTA, tenantName: "Giliuta", teamId: "team-k1",
  teamName: "Команда 1", teamColor: null, isActive,
});
const names = (chips: { name: string }[]) => chips.map((c) => c.name);

describe("лента календарей — состав от компании устройства", () => {
  // Ровно кадр, который видела соседняя сессия: человек вернулся в AirFix, а
  // список ещё прежний и считает активной Giliuta. По флагу сервера ряд вышел
  // «Y&D, Y&D» без «Команды 1».
  test("возврат с устаревшим флагом: ни дубля, ни пропажи", () => {
    const chips = composeCalendarChips({
      own: [{ id: "team-yd", name: "Y&D" }],
      myCalendars: [yd(false), k1(true)],
      activeTenantId: AIRFIX,
    });
    assert.deepEqual(names(chips), ["Y&D", "Команда 1"]);
    assert.equal(chips.find((c) => c.name === "Y&D")?.outline, undefined);
    assert.equal(chips.find((c) => c.name === "Команда 1")?.outline, true);
  });

  test("уход с устаревшим флагом — зеркально", () => {
    const chips = composeCalendarChips({
      own: [{ id: "team-k1", name: "Команда 1" }],
      myCalendars: [yd(true), k1(false)],
      activeTenantId: GILIUTA,
    });
    assert.deepEqual(names(chips), ["Y&D", "Команда 1"]);
    assert.equal(chips.find((c) => c.name === "Y&D")?.outline, true);
    assert.equal(chips.find((c) => c.name === "Команда 1")?.outline, undefined);
  });

  test("порядок один и тот же, где бы человек ни стоял", () => {
    const inAirfix = composeCalendarChips({
      own: [{ id: "team-yd", name: "Y&D" }],
      myCalendars: [yd(true), k1(false)],
      activeTenantId: AIRFIX,
    });
    const inGiliuta = composeCalendarChips({
      own: [{ id: "team-k1", name: "Команда 1" }],
      myCalendars: [yd(false), k1(true)],
      activeTenantId: GILIUTA,
    });
    assert.deepEqual(names(inAirfix), names(inGiliuta));
  });

  test("компания устройства ещё неизвестна — берётся флаг, а не «всё чужое»", () => {
    const chips = composeCalendarChips({
      own: [{ id: "team-yd", name: "Y&D" }],
      myCalendars: [yd(true), k1(false)],
      activeTenantId: null,
    });
    assert.deepEqual(names(chips), ["Y&D", "Команда 1"]);
  });
});
