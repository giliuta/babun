import { beforeEach, describe, expect, it } from "bun:test";
import { MemoryKVStorage, getStorage, setStorage } from "../storage";
import {
  loadPersonalEventTypes,
  savePersonalEventTypes,
  type PersonalEventType,
} from "./personal-event-types";

const lunch: PersonalEventType = {
  id: "pet-lunch",
  label: "Обед",
  icon: "coffee",
  color: "#007AFF",
  defaultDuration: 60,
  allDay: false,
  order: 0,
  hidden: false,
};

beforeEach(() => setStorage(new MemoryKVStorage()));

describe("кэш типов событий — по компании", () => {
  it("типы одной компании не видны в другой", () => {
    savePersonalEventTypes([lunch], "tenant-a");
    expect(loadPersonalEventTypes("tenant-a").map((t) => t.id)).toEqual(["pet-lunch"]);
    expect(loadPersonalEventTypes("tenant-b")).toEqual([]);
  });

  it("старый общий ключ без компании не читается", () => {
    getStorage().set("babun2:settings:personal-event-types", [lunch]);
    expect(loadPersonalEventTypes("tenant-a")).toEqual([]);
  });
});
