import { beforeEach, describe, expect, it } from "bun:test";
import { MemoryKVStorage, setStorage } from "../storage";
import {
  createBlankEquipment,
  hasEquipmentCache,
  hasEquipmentServerSync,
  loadEquipment,
  markEquipmentServerSynced,
  saveEquipment,
} from "./equipment";

const item = createBlankEquipment({ id: "eq-1", name: "Манометр" });

beforeEach(() => setStorage(new MemoryKVStorage()));

describe("tenant-scoped equipment cache", () => {
  it("isolates inventory snapshots between tenants", () => {
    saveEquipment([item], "tenant-a");
    expect(loadEquipment("tenant-a")).toEqual([item]);
    expect(loadEquipment("tenant-b")).toEqual([]);
  });

  it("lets only one tenant claim the legacy inventory", () => {
    saveEquipment([item]);
    expect(hasEquipmentCache("tenant-a")).toBe(true);
    expect(loadEquipment("tenant-a")).toEqual([item]);
    expect(hasEquipmentCache("tenant-b")).toBe(false);
    expect(loadEquipment("tenant-b")).toEqual([]);
  });

  it("distinguishes a canonical empty snapshot from a cold cache", () => {
    expect(hasEquipmentCache("tenant-a")).toBe(false);
    saveEquipment([], "tenant-a");
    expect(hasEquipmentCache("tenant-a")).toBe(true);
    expect(loadEquipment("tenant-a")).toEqual([]);
  });

  it("tracks server authority per tenant", () => {
    markEquipmentServerSynced("tenant-a");
    expect(hasEquipmentServerSync("tenant-a")).toBe(true);
    expect(hasEquipmentServerSync("tenant-b")).toBe(false);
  });

  it("does not expose an owner snapshot to a restricted role", () => {
    saveEquipment([item], "tenant-a");

    expect(hasEquipmentCache("tenant-a", "master")).toBe(false);
    expect(loadEquipment("tenant-a", "master")).toEqual([]);
    expect(loadEquipment("tenant-a")).toEqual([item]);
  });

  it("keeps owner and restricted snapshots independent", () => {
    const masterItem = createBlankEquipment({
      id: "eq-master",
      name: "Инструмент мастера",
    });
    saveEquipment([item], "tenant-a");
    saveEquipment([masterItem], "tenant-a", "master");

    expect(loadEquipment("tenant-a")).toEqual([item]);
    expect(loadEquipment("tenant-a", "master")).toEqual([masterItem]);
  });

  it("tracks server authority separately for restricted roles", () => {
    markEquipmentServerSynced("tenant-a");
    expect(hasEquipmentServerSync("tenant-a")).toBe(true);
    expect(hasEquipmentServerSync("tenant-a", "master")).toBe(false);

    markEquipmentServerSynced("tenant-a", "master");
    expect(hasEquipmentServerSync("tenant-a")).toBe(true);
    expect(hasEquipmentServerSync("tenant-a", "master")).toBe(true);
  });
});
