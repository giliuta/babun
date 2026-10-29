import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { EMPTY_FILTER, type ClientsFilter, type FacetOption } from "../filter";
import {
  activeSummaryOf,
  periodSplit,
  summarize,
  toggleIn,
  zeroHintFor,
} from "./sheet-text";

const opt = (value: string, label: string, color = ""): FacetOption => ({ value, label, color });
const filterOf = (patch: Partial<ClientsFilter>): ClientsFilter => ({ ...EMPTY_FILTER, ...patch });
const NONE: Record<string, number> = {};

describe("summarize", () => {
  const options = [opt("a", "Альфа", "#f00"), opt("b", "Бета"), opt("c", "Гамма")];

  test("nothing selected — no summary", () => {
    assert.equal(summarize(options, []), null);
  });

  test("first chosen by option order, the rest counted", () => {
    assert.deepEqual(summarize(options, ["c", "a"]), { label: "Альфа", extra: 1, color: "#f00" });
  });

  test("selection of vanished options — no summary", () => {
    assert.equal(summarize(options, ["zzz"]), null);
  });
});

describe("toggleIn", () => {
  test("adds a missing value and removes a present one", () => {
    assert.deepEqual(toggleIn(["a"], "b"), ["a", "b"]);
    assert.deepEqual(toggleIn(["a", "b"], "a"), ["b"]);
  });
});

describe("zeroHintFor", () => {
  test("silent while something is shown", () => {
    assert.equal(zeroHintFor(3, { tag: 10 }, filterOf({ activeTags: ["t"] }), ""), null);
  });

  test("names the active condition that frees the most clients", () => {
    const f = filterOf({ activeTags: ["t"], segments: ["debt"] });
    assert.equal(zeroHintFor(0, { tag: 2, segment: 5 }, f, ""), "Без «Статус» — 5 клиентов");
  });

  test("an inactive condition is never blamed", () => {
    const f = filterOf({ activeTags: ["t"] });
    assert.equal(zeroHintFor(0, { tag: 1, segment: 9 }, f, ""), "Без «Теги» — 1 клиент");
  });

  test("search counts as a condition", () => {
    assert.equal(zeroHintFor(0, { search: 2 }, EMPTY_FILTER, "ив"), "Без «Поиск» — 2 клиента");
  });

  test("no single condition helps — generic advice", () => {
    assert.equal(zeroHintFor(0, NONE, filterOf({ activeTags: ["t"] }), ""), "Ничего не найдено — снимите условия");
  });
});

describe("activeSummaryOf", () => {
  const base = {
    tagOptions: [opt("t1", "VIP")],
    teamOptions: [opt("tm1", "Бригада")],
    sourceOptions: [opt("n:instagram", "Instagram")],
  };

  test("nothing active and no search — no summary", () => {
    assert.equal(activeSummaryOf({ ...base, filter: EMPTY_FILTER, search: "  ", nothingActive: true }), null);
  });

  test("search first, then groups in row order; unknown ids dropped", () => {
    const filter = filterOf({
      segments: ["debt"],
      selectedCities: ["Лимассол"],
      activeTags: ["t1", "gone"],
      selectedTeams: ["tm1"],
      sources: ["n:instagram"],
    });
    assert.equal(
      activeSummaryOf({ ...base, filter, search: " ив ", nothingActive: false }),
      "Поиск: «ив» · Должники · Лимассол · VIP · Бригада · Instagram",
    );
  });
});

describe("periodSplit", () => {
  const now = new Date(2026, 9, 13, 12, 0);

  test("all time without data — dash and a draft from the month start", () => {
    const s = periodSplit(null, null, null, now);
    assert.equal(s.allSpanDates, null);
    assert.equal(s.periodName, "Всё время");
    assert.equal(s.datesLabel, "Даты");
    assert.equal(s.draftFrom, "2026-10-01");
    assert.equal(s.draftTo, "2026-10-13");
  });

  test("all time spans data in both directions around today", () => {
    const s = periodSplit(null, "2026-03-02", "2026-12-20", now);
    assert.equal(s.allSpanDates, "02.03.26 – 20.12.26");
    // Рядом со «Всё время» дат нет — только дверь к колёсам.
    assert.equal(s.datesLabel, "Даты");
    assert.equal(s.draftFrom, "2026-03-02");
  });

  test("future-only data starts the span today", () => {
    const s = periodSplit(null, "2026-11-01", "2026-11-30", now);
    assert.equal(s.allSpanDates, "13.10.26 – 30.11.26");
    assert.equal(s.draftFrom, "2026-10-01");
  });

  test("a chosen period wins over the data span", () => {
    const period = { preset: "custom" as const, from: "2026-06-01", to: "2026-06-15" };
    const s = periodSplit(period, "2026-01-01", null, now);
    assert.equal(s.datesLabel, "01.06.26 – 15.06.26");
    assert.equal(s.draftFrom, "2026-06-01");
    assert.equal(s.draftTo, "2026-06-15");
  });
});
