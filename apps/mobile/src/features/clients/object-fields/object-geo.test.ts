import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { googleMapsSearchUrl } from "@/features/clients/location-request-form";
import { composeAddress } from "@/features/clients/object-address";
import { coordsOf, objectGeoQuery } from "./object-geo";

describe("coordsOf", () => {
  test("empty or plain text — no point", () => {
    assert.equal(coordsOf("  "), null);
    assert.equal(coordsOf("Makariou 12"), null);
  });

  test("a pin link round-trips to its coordinates", () => {
    assert.deepEqual(coordsOf(googleMapsSearchUrl({ lat: 34.6786, lng: 33.0413 })), {
      lat: 34.6786,
      lng: 33.0413,
    });
  });
});

describe("objectGeoQuery", () => {
  test("exact address with a place wins over the main line", () => {
    const parts = { street: "Makariou 12", floor: "3", city: "Limassol" };
    const query = objectGeoQuery({ parts, target: "что-то другое" });
    assert.equal(query, composeAddress(parts, { forRoute: true }));
    assert.doesNotMatch(query, /эт\./);
  });

  test("without a place — the trimmed main line", () => {
    assert.equal(objectGeoQuery({ parts: {}, target: "  Makariou 12  " }), "Makariou 12");
  });

  test("a link is never geocoded", () => {
    assert.equal(objectGeoQuery({ parts: {}, target: "https://maps.app.goo.gl/abc" }), "");
  });
});
