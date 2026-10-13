import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { EMPTY_FILTER, SEGMENT_OPTIONS, SORT_BLOCKS, type ClientsFilter, type FacetOption } from "../filter";
import type { FacetCounts } from "../useClientFilters";
import { buildFacetConfig, segmentAsOptions, sortBlocksOf } from "./facet-config";

const opt = (value: string, label: string, legacy = false): FacetOption => ({
  value,
  label,
  color: "",
  ...(legacy ? { legacy } : {}),
});

const counts: FacetCounts = {
  segment: Object.fromEntries(SEGMENT_OPTIONS.map((o) => [o.key, 0])) as FacetCounts["segment"],
  city: {},
  tag: {},
  team: {},
  source: {},
  property: {},
  withoutOne: {},
};

function setup(filter: ClientsFilter = EMPTY_FILTER) {
  const applied: ClientsFilter[] = [];
  const config = buildFacetConfig(
    filter,
    {
      cityOptions: [opt("Лимассол", "Лимассол"), opt("старый", "старый", true)],
      tagOptions: [opt("t1", "VIP")],
      teamOptions: [opt("tm1", "Бригада")],
      sourceOptions: [opt("unknown", "Неизвестно")],
      propertyOptions: [],
      facetCounts: counts,
    },
    (next) => applied.push(next),
  );
  return { config, applied };
}

describe("buildFacetConfig", () => {
  test("one popup per facet, in sheet order", () => {
    assert.deepEqual(Object.keys(setup().config), ["segment", "city", "tag", "team", "source", "property"]);
  });

  test("labels split library and legacy into separate blocks", () => {
    const blocks = setup().config.city.blocks;
    assert.deepEqual(blocks.map((b) => b.map((o) => o.value)), [["Лимассол"], ["старый"]]);
  });

  test("statuses carry block titles and rules, without a colour tick", () => {
    const segment = setup().config.segment;
    assert.ok(segment.blockTitles && segment.blockTitles.length === segment.blocks.length);
    assert.ok(segment.rules);
    assert.ok(segment.blocks.flat().every((o) => o.color === ""));
  });

  test("toggle adds and removes, clear empties only its own facet", () => {
    const { config, applied } = setup({ ...EMPTY_FILTER, activeTags: ["t1"], sources: ["unknown"] });
    config.tag.toggle("t2");
    config.tag.toggle("t1");
    config.source.clear();
    assert.deepEqual(applied[0].activeTags, ["t1", "t2"]);
    assert.deepEqual(applied[1].activeTags, []);
    assert.deepEqual(applied[2].sources, []);
    assert.deepEqual(applied[2].activeTags, ["t1"]);
  });
});

describe("static option lists", () => {
  test("statuses keep the canonical order", () => {
    assert.deepEqual(segmentAsOptions().map((o) => o.value), SEGMENT_OPTIONS.map((o) => o.key));
  });

  test("sort blocks mirror SORT_BLOCKS", () => {
    assert.deepEqual(sortBlocksOf().map((b) => b.map((o) => o.value)), SORT_BLOCKS);
  });
});
