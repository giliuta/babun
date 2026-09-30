import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { calendarCards } from "./masters-list";

const K1 = "team-1";
const K2 = "team-2";
const teams = [
  { id: K1, lead_ids: [], helper_ids: [] },
  { id: K2, lead_ids: [], helper_ids: ["master-old"] },
];
const none = new Set<string>();
const ids = (cards: { id: string }[]) => cards.map((card) => card.id);

describe("карточки мастеров в разделе календаря", () => {
  const dmitry = { id: "master-dmitry", team_id: K1, user_id: "user-dmitry" };

  test("мастер Команды 1 не стоит карточкой в Команде 2", () => {
    assert.deepEqual(ids(calendarCards([dmitry], { teamId: K2, teams, staffUserIds: none })), []);
  });

  test("в своём календаре его карточку прячет строка «С доступом к календарю»", () => {
    const staff = new Set(["user-dmitry"]);
    assert.deepEqual(ids(calendarCards([dmitry], { teamId: K1, teams, staffUserIds: staff })), []);
    assert.deepEqual(ids(calendarCards([dmitry], { teamId: K1, teams, staffUserIds: none })), [
      "master-dmitry",
    ]);
  });

  test("старый состав бригады относит карточку к своему календарю", () => {
    const old = { id: "master-old", team_id: null, user_id: null };
    assert.deepEqual(ids(calendarCards([old], { teamId: K2, teams, staffUserIds: none })), [
      "master-old",
    ]);
    assert.deepEqual(ids(calendarCards([old], { teamId: K1, teams, staffUserIds: none })), []);
  });

  test("ничья карточка видна в каждом календаре — иначе её не открыть", () => {
    const loose = { id: "master-loose", team_id: null, user_id: null };
    const archived = { id: "master-archived", team_id: "team-archived", user_id: null };
    for (const teamId of [K1, K2]) {
      assert.deepEqual(
        ids(calendarCards([loose, archived], { teamId, teams, staffUserIds: none })),
        ["master-loose", "master-archived"],
      );
    }
  });

  test("без календаря в адресе — все карточки, кроме людей с доступом", () => {
    const staff = new Set(["user-dmitry"]);
    const loose = { id: "master-loose", team_id: null, user_id: null };
    assert.deepEqual(
      ids(calendarCards([dmitry, loose], { teamId: undefined, teams, staffUserIds: staff })),
      ["master-loose"],
    );
  });
});
