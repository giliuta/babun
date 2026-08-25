import { beforeEach, describe, expect, it } from "bun:test";
import { MemoryKVStorage, setStorage } from "../storage";
import {
  hasLocationLabelsServerSync,
  loadLocationLabels,
  markLocationLabelsServerSynced,
  saveLocationLabels,
  type LocationLabel,
} from "./location-labels";

const labels: LocationLabel[] = [{ id: "home", name: "Дом" }];

beforeEach(() => setStorage(new MemoryKVStorage()));

describe("tenant-scoped location label cache", () => {
  it("keeps server caches isolated between accounts", () => {
    saveLocationLabels(labels, "tenant-a");
    expect(loadLocationLabels("tenant-a")).toEqual(labels);
    expect(loadLocationLabels("tenant-b")).toEqual([]);
  });

  it("lets only one tenant claim the legacy unscoped cache", () => {
    saveLocationLabels(labels);
    expect(loadLocationLabels("tenant-a")).toEqual(labels);
    expect(loadLocationLabels("tenant-b")).toEqual([]);
  });

  it("tracks server authority separately for every tenant", () => {
    markLocationLabelsServerSynced("tenant-a");
    expect(hasLocationLabelsServerSync("tenant-a")).toBe(true);
    expect(hasLocationLabelsServerSync("tenant-b")).toBe(false);
  });
});
