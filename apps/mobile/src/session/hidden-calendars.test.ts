import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { calendarKey, canHideCalendar, effectiveHidden } from "./hidden-calendars";

// Скрытый календарь (владелец 04.10): скрыть можно, пока есть другой видимый;
// другие пропали — скрытый сам возвращается.

const own = { tenantId: "me", teamId: "personal" };
const shared = { tenantId: "firm", teamId: "team-1" };
const key = (c: { tenantId: string; teamId: string }) => calendarKey(c.tenantId, c.teamId);

describe("скрытые календари", () => {
  test("свой скрыт, пока есть чужой", () => {
    const hidden = effectiveHidden([own, shared], new Set([key(own)]));
    assert.deepEqual([...hidden], [key(own)]);
  });

  test("доступ к чужому забрали — свой снова виден", () => {
    assert.equal(effectiveHidden([own], new Set([key(own)])).size, 0);
  });

  test("скрыты все — не скрыт ни один", () => {
    assert.equal(effectiveHidden([own, shared], new Set([key(own), key(shared)])).size, 0);
  });

  test("пока список не пришёл — верим сохранённому", () => {
    assert.deepEqual([...effectiveHidden(null, new Set([key(own)]))], [key(own)]);
  });

  test("скрыть можно, только когда остаётся другой видимый", () => {
    assert.equal(canHideCalendar([own], new Set(), own), false);
    assert.equal(canHideCalendar([own, shared], new Set(), own), true);
    assert.equal(canHideCalendar([own, shared], new Set([key(shared)]), own), false);
  });
});
