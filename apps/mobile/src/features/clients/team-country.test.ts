import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { countryForTeam } from "./team-country";

// Код страны номера — из часового пояса команды (владелец 02.10).

describe("код страны номера по поясу команды", () => {
  test("пояс команды решает", () => {
    assert.equal(countryForTeam({ teamZone: "Europe/Athens", companyZone: "Asia/Nicosia", tenantCountry: "CY" }), "GR");
    assert.equal(countryForTeam({ teamZone: "Europe/Kyiv", companyZone: null, tenantCountry: "CY" }), "UA");
  });

  test("у команды пояса нет — пояс компании", () => {
    assert.equal(countryForTeam({ teamZone: null, companyZone: "Asia/Nicosia", tenantCountry: "GR" }), "CY");
  });

  test("страна пояса не среди кодов номера — страна компании", () => {
    assert.equal(countryForTeam({ teamZone: "Asia/Tokyo", companyZone: null, tenantCountry: "GR" }), "GR");
    assert.equal(countryForTeam({ teamZone: null, companyZone: null, tenantCountry: null }), "CY");
  });
});
