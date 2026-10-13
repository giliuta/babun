import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { EMPTY_FILTER, type ClientsFilter } from "../filter";
import { dataSpanOf, filterTagsFor, pruneFilter, uniqueById } from "./list-derive";

describe("uniqueById", () => {
  test("first row with an id wins, order kept", () => {
    const rows = [
      { id: "a", from: "own" },
      { id: "b", from: "own" },
      { id: "a", from: "guest" },
    ];
    assert.deepEqual(uniqueById(rows), [rows[0], rows[1]]);
  });
});

describe("dataSpanOf", () => {
  test("first and last date, cancelled and undated skipped", () => {
    const span = dataSpanOf([
      { status: "scheduled", date: "2026-05-02" },
      { status: "cancelled", date: "2025-01-01" },
      { status: "completed", date: "2026-01-10" },
      { status: "scheduled", date: "" },
      { status: "scheduled", date: "2026-11-30" },
    ]);
    assert.deepEqual(span, { from: "2026-01-10", to: "2026-11-30" });
  });

  test("no appointments — no span", () => {
    assert.deepEqual(dataSpanOf([]), { from: null, to: null });
  });
});

describe("filterTagsFor", () => {
  const teams = [
    { id: "t1", name: "Север" },
    { id: "t2", name: "Юг" },
  ];
  const tags = [
    { id: "1", name: "VIP", team_id: "t1" },
    { id: "2", name: "vip ", team_id: "t2" },
    { id: "3", name: "Опт", team_id: null },
    { id: "4", name: "Сад", team_id: "t2" },
  ];

  test("under a chip — that team's tags and shared ones", () => {
    assert.deepEqual(filterTagsFor(tags, teams, "t1").map((t) => t.id), ["1", "3"]);
  });

  test("without a chip — namesakes of different teams are signed by team", () => {
    assert.deepEqual(
      filterTagsFor(tags, teams, null).map((t) => t.name),
      ["VIP · Север", "vip  · Юг", "Опт", "Сад"],
    );
  });
});

describe("pruneFilter", () => {
  const live = {
    teamOptions: [{ value: "tm1" }],
    tagOptions: [{ value: "t1" }],
    cityOptions: [{ value: "Лимассол" }],
    sourceOptions: [{ value: "unknown" }],
    sourcesReady: true,
    tagsReady: true,
    citiesLoaded: true,
  };
  const f = (patch: Partial<ClientsFilter>): ClientsFilter => ({ ...EMPTY_FILTER, ...patch });

  test("nothing stale — the very same object", () => {
    const filter = f({ activeTags: ["t1"], selectedCities: ["Лимассол"] });
    assert.equal(pruneFilter(filter, live), filter);
  });

  test("drops vanished tags, labels, sources and any team", () => {
    const next = pruneFilter(
      f({ activeTags: ["t1", "gone"], selectedCities: ["Пафос"], sources: ["n:x"], selectedTeams: ["tm1"] }),
      live,
    );
    assert.deepEqual(
      [next.activeTags, next.selectedCities, next.sources, next.selectedTeams],
      [["t1"], [], [], []],
    );
  });

  test("keeps values while their reference has not arrived", () => {
    const filter = f({ activeTags: ["x"], selectedCities: ["y"], sources: ["z"] });
    assert.equal(
      pruneFilter(filter, { ...live, tagsReady: false, citiesLoaded: false, sourcesReady: false }),
      filter,
    );
  });
});
