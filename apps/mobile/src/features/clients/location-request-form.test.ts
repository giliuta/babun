import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildLocationPayload,
  EMPTY_LOCATION_FORM,
  formatCoords,
  googleMapsSearchUrl,
  locationFormReady,
  osmEmbedUrl,
  parseLookup,
  parseSubmit,
  partsFromNominatim,
  type LocationForm,
} from "./location-request-form";

const form = (over: Partial<LocationForm>): LocationForm => ({
  ...EMPTY_LOCATION_FORM,
  ...over,
});

describe("locationFormReady", () => {
  test("пусто — отправлять нечего", () => {
    assert.equal(locationFormReady(form({})), false);
    assert.equal(locationFormReady(form({ parts: { floor: "3" } })), false);
    assert.equal(locationFormReady(form({ pin: "not a url" })), false);
  });

  test("точка, строка, ссылка-пин или «где» в точном адресе", () => {
    assert.equal(locationFormReady(form({ coords: { lat: 34.7, lng: 33.0 } })), true);
    assert.equal(locationFormReady(form({ line: "Makariou 12" })), true);
    assert.equal(locationFormReady(form({ pin: "https://maps.app.goo.gl/abc" })), true);
    assert.equal(locationFormReady(form({ parts: { city: "Лимасол" } })), true);
  });
});

describe("buildLocationPayload", () => {
  test("текст в строке — улица; части и заметка чистятся", () => {
    const payload = buildLocationPayload(
      form({
        line: " Makariou 12 \n",
        parts: { entrance: " 2 ", floor: "3", apartment: "", city: "Лимасол" },
        label: " Квартира ",
        note: " код 1234 ",
      }),
    );
    assert.deepEqual(payload, {
      street: "Makariou 12",
      entrance: "2",
      floor: "3",
      city: "Лимасол",
      label: "Квартира",
      note: "код 1234",
    });
  });

  test("ссылка в строке — пин, адрес вытаскивается из /place/", () => {
    const payload = buildLocationPayload(
      form({ line: "https://www.google.com/maps/place/Makariou+12,+Limassol/@34.7,33.0,17z" }),
    );
    assert.equal(
      payload.map_url,
      "https://www.google.com/maps/place/Makariou+12,+Limassol/@34.7,33.0,17z",
    );
    assert.equal(payload.street, "Makariou 12, Limassol");
  });

  test("короткая ссылка — только пин, без улицы", () => {
    const payload = buildLocationPayload(form({ line: "https://maps.app.goo.gl/abc" }));
    assert.deepEqual(payload, { map_url: "https://maps.app.goo.gl/abc" });
  });

  test("пин из точного адреса главнее ссылки в строке; не-ссылка в пине не едет", () => {
    const withPin = buildLocationPayload(
      form({ line: "https://maps.app.goo.gl/abc", pin: "https://maps.app.goo.gl/xyz" }),
    );
    assert.equal(withPin.map_url, "https://maps.app.goo.gl/xyz");
    const junkPin = buildLocationPayload(form({ line: "Makariou 12", pin: "junk" }));
    assert.equal(junkPin.map_url, undefined);
    assert.equal(junkPin.street, "Makariou 12");
  });

  test("точка уезжает строками lat/lng", () => {
    const payload = buildLocationPayload(form({ coords: { lat: 34.7071, lng: 33.0226 } }));
    assert.deepEqual(payload, { lat: "34.7071", lng: "33.0226" });
  });
});

describe("координаты и карта", () => {
  test("formatCoords — шесть знаков без хвоста нулей", () => {
    assert.equal(formatCoords({ lat: 34.70710004, lng: 33.0226 }), "34.7071, 33.0226");
    assert.equal(formatCoords({ lat: 35, lng: -33.5 }), "35, -33.5");
  });

  test("ссылки на Google и врезку OSM", () => {
    assert.equal(
      googleMapsSearchUrl({ lat: 34.7071, lng: 33.0226 }),
      "https://www.google.com/maps/search/?api=1&query=34.7071,33.0226",
    );
    const embed = osmEmbedUrl({ lat: 34.7071, lng: 33.0226 });
    assert.ok(embed.startsWith("https://www.openstreetmap.org/export/embed.html?bbox="));
    assert.ok(embed.endsWith("&layer=mapnik&marker=34.7071,33.0226"));
    assert.ok(embed.includes("33.018600,34.705100,33.026600,34.709100"));
  });
});

describe("ответы сервера", () => {
  test("parseLookup — состояние и шапка, мусор → missing", () => {
    const ok = parseLookup({
      state: "pending",
      business_name: " AirFix LTD ",
      logo_url: null,
      client_first_name: "Nikita",
      labels: ["Дом", "", 5, "Офис"],
      expires_at: "2026-09-14T13:55:35+00:00",
    });
    assert.deepEqual(ok, {
      state: "pending",
      businessName: "AirFix LTD",
      logoUrl: null,
      clientFirstName: "Nikita",
      labels: ["Дом", "Офис"],
      expiresAt: "2026-09-14T13:55:35+00:00",
    });
    assert.equal(parseLookup(null).state, "missing");
    assert.equal(parseLookup({ state: "weird" }).state, "missing");
    assert.deepEqual(parseLookup([]).labels, []);
  });

  test("parseSubmit — удача с адресом, отказ с состоянием", () => {
    assert.deepEqual(parseSubmit({ ok: true, address: "Makariou 12" }), {
      ok: true,
      address: "Makariou 12",
    });
    assert.deepEqual(parseSubmit({ ok: false, state: "used" }), { ok: false, state: "used" });
    assert.deepEqual(parseSubmit("garbage"), { ok: false, state: "missing" });
  });

  test("partsFromNominatim — улица с домом, город, индекс", () => {
    assert.deepEqual(
      partsFromNominatim({
        address: {
          road: "Makariou III",
          house_number: "12",
          town: "Limassol",
          postcode: "3025",
          country: "Cyprus",
        },
      }),
      { street: "Makariou III 12", city: "Limassol", zip: "3025" },
    );
    assert.deepEqual(partsFromNominatim({ address: { village: "Pissouri" } }), {
      city: "Pissouri",
    });
    assert.deepEqual(partsFromNominatim(null), {});
  });
});
