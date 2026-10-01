import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { MemberAccessMap } from "../access/access-map";
import {
  anyClientSetting,
  clientSettingLevels,
  type ClientSettingsInput,
} from "./settings-levels";

// «НАСТРОЙКИ КЛИЕНТОВ» ПО ПРАВАМ (владелец 01.10): строка шестерёнки — по
// своему праву команды, как «Настройки команды» у календаря.

const TEAM = "team-1";
const OTHER = "team-3";

const map = (levels: Record<string, Record<string, "off" | "read" | "write">>): MemberAccessMap => ({
  tenantId: "t",
  isOwner: false,
  version: 1,
  company: {},
  calendars: levels,
  attachedCalendars: Object.keys(levels),
});

const partner = (over: Partial<ClientSettingsInput>): ClientSettingsInput => ({
  own: false,
  activeMember: true,
  role: "master",
  map: map({
    [TEAM]: { "clients.settings_ways": "write", "clients.settings_tags": "read" },
  }),
  teamId: TEAM,
  ...over,
});

describe("строки шестерёнки клиентов", () => {
  test("своя компания — всё правится, карта не нужна", () => {
    const levels = clientSettingLevels({ own: true, activeMember: false, role: "owner", map: undefined, teamId: null });
    assert.deepEqual(Object.values(levels), ["write", "write", "write", "write", "write"]);
  });

  test("партнёру — ступень его права в этой команде", () => {
    const levels = clientSettingLevels(partner({}));
    assert.equal(levels.ways, "write");
    assert.equal(levels.tags, "read");
    assert.equal(levels.card, "hidden");
    assert.equal(levels.maps, "hidden");
    assert.equal(levels.objects, "hidden");
    assert.equal(anyClientSetting(levels), true);
  });

  test("в другой команде его права не действуют", () => {
    const levels = clientSettingLevels(partner({ teamId: OTHER }));
    assert.equal(anyClientSetting(levels), false);
  });

  test("компания не открыта в календаре — строк нет: правка шла бы не туда", () => {
    assert.equal(anyClientSetting(clientSettingLevels(partner({ activeMember: false }))), false);
  });

  test("карта прав ещё едет — строк нет, а не «всё открыто»", () => {
    assert.equal(anyClientSetting(clientSettingLevels(partner({ map: undefined }))), false);
  });

  test("без команды и не партнёру — строк нет", () => {
    assert.equal(anyClientSetting(clientSettingLevels(partner({ teamId: null }))), false);
    assert.equal(anyClientSetting(clientSettingLevels(partner({ role: "dispatcher" }))), false);
  });
});
