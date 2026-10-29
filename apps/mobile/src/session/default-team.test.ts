import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { pickDefaultTeamId } from "./default-team-rule";

const T = "tenant-1";
const teams = [
  { id: "my", tenantId: T },
  { id: "yd", tenantId: T },
  { id: "c1", tenantId: T },
];
const hidden = (ids: string[]) => (_tenant: string | null | undefined, teamId: string) =>
  ids.includes(teamId);

describe("команда экрана настроек по умолчанию", () => {
  test("скрытый календарь первым не открывается — первый видимый", () => {
    assert.equal(pickDefaultTeamId(teams, null, hidden(["my"])), "yd");
  });
  test("открытый в календаре — раньше всех", () => {
    assert.equal(pickDefaultTeamId(teams, "c1", hidden(["my"])), "c1");
  });
  test("открытый не из этой ленты — правило дальше", () => {
    assert.equal(pickDefaultTeamId(teams, "чужая", hidden([])), "my");
  });
  test("скрыты все — первый, а не пусто", () => {
    assert.equal(pickDefaultTeamId(teams, null, hidden(["my", "yd", "c1"])), "my");
  });
  test("команд нет — null", () => {
    assert.equal(pickDefaultTeamId([], null, hidden([])), null);
  });
});
