import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { humanDayMaybeYear } from "./helpers";
import { WHEN_WEEKS_FWD, formatDateRu } from "./when-dates";

const TODAY = new Date(2026, 9, 27);

describe("лист «Когда»", () => {
  test("дата через год с лишним ставится: полоса тянется на два года вперёд", () => {
    // 5 марта 2028 — 71 неделя от 27 октября 2026; полгода (26) её не доставали.
    const weeks = Math.ceil((new Date(2028, 2, 5).getTime() - TODAY.getTime()) / (7 * 86_400_000));
    assert.ok(WHEN_WEEKS_FWD >= weeks, `${WHEN_WEEKS_FWD} < ${weeks}`);
    assert.ok(WHEN_WEEKS_FWD >= 104);
  });

  test("заголовок листа: год только у чужого года", () => {
    assert.equal(formatDateRu("2026-11-05", TODAY), "5 ноября");
    assert.equal(formatDateRu("2027-03-05", TODAY), "5 марта 2027");
    assert.equal(formatDateRu("2025-12-31", TODAY), "31 декабря 2025");
  });

  test("строка «Когда» в форме: год только у чужого года", () => {
    assert.equal(humanDayMaybeYear("2026-11-05", TODAY), "чт, 5 ноября");
    assert.equal(humanDayMaybeYear("2027-03-05", TODAY), "пт, 5 марта 2027");
  });
});
