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

  test("с 12.10 в списке все страны: пояс Токио — Япония; пояс без страны — страна компании", () => {
    assert.equal(countryForTeam({ teamZone: "Asia/Tokyo", companyZone: null, tenantCountry: "GR" }), "JP");
    assert.equal(countryForTeam({ teamZone: "Etc/UTC", companyZone: null, tenantCountry: "GR" }), "GR");
    assert.equal(countryForTeam({ teamZone: null, companyZone: null, tenantCountry: null }), "CY");
  });
});

describe("все страны мира в выборе кода (владелец 12.10)", () => {
  test("Беларусь +375 есть и стоит среди частых", async () => {
    const { SUPPORTED_COUNTRIES, POPULAR_COUNTRIES, countryDialCode, countryNameIn, tryToE164 } = await import("./phone");
    assert.ok(SUPPORTED_COUNTRIES.length > 200);
    assert.ok(POPULAR_COUNTRIES.includes("BY"));
    assert.equal(countryDialCode("BY"), "+375");
    assert.equal(countryNameIn("BY", "ru"), "Беларусь");
    assert.equal(countryNameIn("BY", "en"), "Belarus");
    assert.equal(tryToE164("+375 29 123 45 67", "CY"), "+375291234567");
  });
});
