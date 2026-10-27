import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  pickPriceListTeam,
  priceRowSub,
  purgeMessage,
  teamPriceList,
  templateCandidates,
} from "./price-list-rules";

const teams = [{ id: "t1" }, { id: "t2" }, { id: "t3" }];
const svc = (team_id: string, name: string, is_active = true) => ({ team_id, name, is_active });

describe("pickPriceListTeam", () => {
  test("the address wins", () => {
    assert.equal(pickPriceListTeam("t3", "t2", teams, []), "t3");
  });
  test("then the team open in the calendar, if it still exists", () => {
    assert.equal(pickPriceListTeam(undefined, "t2", teams, []), "t2");
    assert.equal(pickPriceListTeam(undefined, "gone", teams, [{ team_id: "t3" }]), "t3");
  });
  test("then the first team that has services, then the first team", () => {
    assert.equal(pickPriceListTeam(undefined, null, teams, [{ team_id: "t2" }]), "t2");
    assert.equal(pickPriceListTeam(undefined, null, teams, []), "t1");
    assert.equal(pickPriceListTeam(undefined, null, [], []), null);
  });
});

describe("templateCandidates", () => {
  const all = [svc("t1", "Чистка"), svc("t2", "чистка "), svc("t2", "Заправка"), svc("t2", "Старое", false)];
  test("only the owner, only with an open team", () => {
    assert.deepEqual(templateCandidates(false, "t1", all), []);
    assert.deepEqual(templateCandidates(true, null, all), []);
  });
  test("live services of other teams not already here by name", () => {
    assert.deepEqual(
      templateCandidates(true, "t1", all).map((s) => s.name),
      ["Заправка"],
    );
  });
});

describe("teamPriceList", () => {
  test("live first, hidden after, other teams out", () => {
    const list = [svc("t1", "a", false), svc("t1", "b"), svc("t2", "c"), svc("t1", "d")];
    assert.deepEqual(teamPriceList(list, "t1").map((s) => s.name), ["b", "d", "a"]);
    assert.deepEqual(teamPriceList(list, null), []);
  });
});

describe("priceRowSub", () => {
  test("plain duration without a ladder", () => {
    assert.equal(priceRowSub({ price_tiers: [], duration_minutes: 90 }), "1 ч 30 мин");
  });
  test("says the price depends on quantity", () => {
    assert.equal(
      priceRowSub({ price_tiers: [{ min_qty: 2, price_per_unit: 50 }], duration_minutes: 30 }),
      "30 мин · цена от количества",
    );
  });
});

describe("purgeMessage", () => {
  test("unused, counted and unknown", () => {
    assert.match(purgeMessage("A", 0), /ещё не стоит ни в одной записи/);
    assert.match(purgeMessage("A", 47), /стоит в 47 записях/);
    // «1 записи» — своя фраза: слово «записи» в словаре — множественное.
    assert.match(purgeMessage("A", 1), /стоит в 1 записи\./);
    assert.match(purgeMessage("A", 21), /стоит в 21 записи\./);
    assert.match(purgeMessage("A", 2), /стоит в 2 записях/);
    assert.match(purgeMessage("A", -1), /может стоять в уже сделанных записях/);
  });
});
