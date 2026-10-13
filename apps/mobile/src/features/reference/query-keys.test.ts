import assert from "node:assert/strict";
import { describe, test } from "node:test";

import * as companyKeys from "@/lib/company-query-keys";
import { referenceKeys } from "./query-keys";

// Right-hand sides are the literal arrays the hooks wrote inline before the
// factories existed. Compared as strings: element order and `null` matter.
const T = "2bc7907e-b149-44a9-92ff-a5e73403031c";
const same = (a: readonly unknown[], b: readonly unknown[]) =>
  assert.equal(JSON.stringify(a), JSON.stringify(b));

describe("reference query keys keep their shape", () => {
  test("prefixes writes invalidate by", () => {
    same(referenceKeys.teamAll(), ["teams"]);
    same(referenceKeys.masterAll(), ["masters"]);
    same(referenceKeys.mastersOfTenant(T), ["masters", T]);
    same(referenceKeys.cityAll(), ["cities"]);
    same(referenceKeys.table("teams"), ["teams"]);
    same(referenceKeys.table("masters"), ["masters"]);
    same(referenceKeys.table("cities"), ["cities"]);
    same(referenceKeys.table("services"), ["services"]);
  });

  test("single-row keys of the hubs", () => {
    same(referenceKeys.team(T, "owner", "team-1"), ["teams", T, "owner", "one", "team-1"]);
    same(referenceKeys.team(T, undefined, "team-1"), ["teams", T, "role-pending", "one", "team-1"]);
    same(referenceKeys.master(T, "owner", "m-1"), ["masters", T, "owner", "one", "m-1"]);
    same(referenceKeys.master(null, undefined, undefined), ["masters", null, "role-pending", "one", undefined]);
  });

  test("prefetched full keys are the shared ones, not copies", () => {
    assert.equal(referenceKeys.teams, companyKeys.teamsQueryKey);
    assert.equal(referenceKeys.masters, companyKeys.mastersQueryKey);
    assert.equal(referenceKeys.cities, companyKeys.citiesQueryKey);
  });

  test("every prefix is a prefix of the full key it refreshes", () => {
    const starts = (prefix: readonly unknown[], key: readonly unknown[]) =>
      same(key.slice(0, prefix.length), prefix);
    starts(referenceKeys.teamAll(), referenceKeys.teams(T, "owner", true));
    starts(referenceKeys.teamAll(), referenceKeys.team(T, "owner", "team-1"));
    starts(referenceKeys.masterAll(), referenceKeys.masters(T, "owner", false));
    starts(referenceKeys.mastersOfTenant(T), referenceKeys.masters(T, "owner", true));
    starts(referenceKeys.mastersOfTenant(T), referenceKeys.master(T, "owner", "m-1"));
    starts(referenceKeys.cityAll(), referenceKeys.cities(T, false, null));
  });
});
