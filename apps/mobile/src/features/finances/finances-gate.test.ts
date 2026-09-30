import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { MemberAccessMap } from "@/features/access/access-map";
import { financesGate } from "./finances-gate";

const map = (over: Partial<MemberAccessMap> = {}): MemberAccessMap => ({
  tenantId: "tenant-1",
  isOwner: false,
  version: 3,
  company: {},
  calendars: {},
  attachedCalendars: [],
  ...over,
});

describe("financesGate", () => {
  test("владелец видит сами финансы и не ждёт карту прав", () => {
    assert.equal(financesGate("owner", undefined), "open");
  });

  test("роль ещё не известна или членства нет — решает граница прав", () => {
    assert.equal(financesGate(undefined, map()), "boundary");
    assert.equal(financesGate(null, map()), "boundary");
  });

  test("карта прав сотрудника ещё едет — не серое и не деньги", () => {
    assert.equal(financesGate("master", undefined), "loading");
  });

  test("без «Доходов и расходов» — та же страница серым, а не «раздел недоступен»", () => {
    assert.equal(financesGate("master", map()), "locked");
    assert.equal(
      financesGate("dispatcher", map({ calendars: { "team-1": { "finance.operations": "off" } } })),
      "locked",
    );
    // Другие блоки финансов без «Доходов и расходов» вкладку не открывают.
    assert.equal(
      financesGate("master", map({ calendars: { "team-1": { "finance.debts": "write" } } })),
      "locked",
    );
  });

  test("«Смотрит» или «Меняет» хотя бы в одном календаре — финансы открыты", () => {
    const readSomewhere = map({
      calendars: { "team-1": { "finance.operations": "off" }, "team-2": { "finance.operations": "read" } },
    });
    assert.equal(financesGate("master", readSomewhere), "open");
    assert.equal(
      financesGate("dispatcher", map({ calendars: { "team-1": { "finance.operations": "write" } } })),
      "open",
    );
  });
});
