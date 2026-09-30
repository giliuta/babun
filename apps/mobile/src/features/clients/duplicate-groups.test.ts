import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { findDuplicateGroups } from "./duplicate-groups";

const card = (
  id: string,
  phone: string,
  created_at: string,
  extra: { deleted_at?: string | null; team_id?: string | null } = {},
) => ({ id, phone, created_at, deleted_at: null, team_id: "t1", ...extra });

describe("дубли — по хвосту номера", () => {
  test("разная запись одного номера — одна группа, старшая карточка первой", () => {
    const groups = findDuplicateGroups([
      card("b", "+357 99 12 34 56", "2026-09-02"),
      card("a", "99123456", "2026-09-01"),
      card("c", "0035799123456", "2026-09-03"),
      card("x", "+357 97 00 00 00", "2026-09-01"),
    ]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0]?.key, "99123456");
    assert.deepEqual(groups[0]?.clients.map((c) => c.id), ["a", "b", "c"]);
  });

  test("короткий номер и пустой не склеиваются", () => {
    const groups = findDuplicateGroups([
      card("a", "1234", "2026-09-01"),
      card("b", "1234", "2026-09-02"),
      card("c", "", "2026-09-01"),
      card("d", "", "2026-09-02"),
    ]);
    assert.deepEqual(groups, []);
  });

  test("архивная карточка дублем не считается", () => {
    const groups = findDuplicateGroups([
      card("a", "99123456", "2026-09-01"),
      card("b", "99123456", "2026-09-02", { deleted_at: "2026-09-03" }),
    ]);
    assert.deepEqual(groups, []);
  });

  test("команде видна группа, где есть хоть одна её карточка", () => {
    const clients = [
      card("a", "99123456", "2026-09-01", { team_id: "t1" }),
      card("b", "99123456", "2026-09-02", { team_id: "t3" }),
      card("c", "97000000", "2026-09-01", { team_id: "t3" }),
      card("d", "97000000", "2026-09-02", { team_id: "t3" }),
    ];
    const ofTeam1 = findDuplicateGroups(clients, new Set(["a"]));
    assert.deepEqual(ofTeam1.map((g) => g.key), ["99123456"]);
    const ofTeam3 = findDuplicateGroups(clients, new Set(["b", "c", "d"]));
    assert.deepEqual(ofTeam3.map((g) => g.key).sort(), ["97000000", "99123456"]);
  });

  test("свежий дубль — наверху", () => {
    const groups = findDuplicateGroups([
      card("a", "99123456", "2026-09-01"),
      card("b", "99123456", "2026-09-02"),
      card("c", "97000000", "2026-09-01"),
      card("d", "97000000", "2026-09-20"),
    ]);
    assert.deepEqual(groups.map((g) => g.key), ["97000000", "99123456"]);
  });
});
