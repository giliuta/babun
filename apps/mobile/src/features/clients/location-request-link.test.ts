import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  isLocationRequestToken,
  locationRequestCaption,
  locationRequestLink,
  locationRequestShareText,
  locationRequestState,
  shortDate,
  visibleLocationRequests,
  type LocationRequest,
} from "./location-request-link";

const TOKEN = "abcdefghijklmnopqrstuvwxyz012345";
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-09-07T12:00:00Z");

function req(over: Partial<LocationRequest> = {}): LocationRequest {
  return {
    id: over.id ?? "r1",
    client_id: "c1",
    token: TOKEN,
    created_at: new Date(NOW - DAY).toISOString(),
    expires_at: new Date(NOW + 6 * DAY).toISOString(),
    used_at: null,
    location_id: null,
    ...over,
  };
}

describe("locationRequestLink", () => {
  test("строит https-ссылку на babun.app по токену", () => {
    assert.equal(locationRequestLink(TOKEN), `https://babun.app/l/${TOKEN}`);
  });

  test("короткий, пустой или чужой токен не проходит", () => {
    assert.equal(isLocationRequestToken("short"), false);
    assert.equal(isLocationRequestToken(""), false);
    assert.equal(isLocationRequestToken(`${TOKEN}.`), false);
    assert.equal(isLocationRequestToken(null), false);
    assert.throws(() => locationRequestLink("nope"));
  });
});

describe("locationRequestShareText", () => {
  test("имя бизнеса впереди, фраза без ссылки", () => {
    const text = locationRequestShareText("AirFix LTD");
    assert.ok(text.startsWith("AirFix LTD: "));
    assert.ok(!text.includes("https://"));
  });

  test("без имени бизнеса — просто фраза", () => {
    assert.ok(!locationRequestShareText(null).includes(":"));
    assert.ok(!locationRequestShareText("  ").startsWith(" "));
  });
});

describe("locationRequestState", () => {
  test("живая → использованная → устаревшая", () => {
    assert.equal(locationRequestState(req(), NOW), "pending");
    assert.equal(locationRequestState(req({ used_at: "2026-09-07T11:00:00Z" }), NOW), "used");
    assert.equal(
      locationRequestState(req({ expires_at: new Date(NOW - 1000).toISOString() }), NOW),
      "expired",
    );
    // Использованная и просроченная — использованная: адрес уже есть.
    assert.equal(
      locationRequestState(
        req({ used_at: "2026-09-01T00:00:00Z", expires_at: new Date(NOW - DAY).toISOString() }),
        NOW,
      ),
      "used",
    );
  });
});

describe("visibleLocationRequests", () => {
  test("одна строка — новейшая живая", () => {
    const older = req({ id: "old", created_at: new Date(NOW - 3 * DAY).toISOString() });
    const newer = req({ id: "new", created_at: new Date(NOW - DAY).toISOString() });
    assert.deepEqual(
      visibleLocationRequests([older, newer], NOW).map((r) => r.id),
      ["new"],
    );
  });

  test("без живой — устаревшая не старше месяца; использованные не видны", () => {
    const used = req({ id: "used", used_at: "2026-09-06T00:00:00Z" });
    const expired = req({ id: "exp", expires_at: new Date(NOW - 2 * DAY).toISOString() });
    assert.deepEqual(
      visibleLocationRequests([used, expired], NOW).map((r) => r.id),
      ["exp"],
    );
    const ancient = req({ id: "anc", expires_at: new Date(NOW - 40 * DAY).toISOString() });
    assert.deepEqual(visibleLocationRequests([used, ancient], NOW), []);
    assert.deepEqual(visibleLocationRequests([], NOW), []);
  });

  test("живая важнее устаревшей, даже если устаревшая новее", () => {
    const pending = req({ id: "p", created_at: new Date(NOW - 5 * DAY).toISOString() });
    const expired = req({
      id: "e",
      created_at: new Date(NOW - DAY).toISOString(),
      expires_at: new Date(NOW - 1000).toISOString(),
    });
    assert.deepEqual(visibleLocationRequests([expired, pending], NOW).map((r) => r.id), ["p"]);
  });
});

describe("locationRequestCaption", () => {
  test("живая: ждём адрес, когда отправлена и до какого числа", () => {
    const { title, caption } = locationRequestCaption(req(), NOW);
    assert.equal(title, "Ждём адрес от клиента");
    assert.ok(caption.startsWith("Ссылка отправлена "));
    assert.ok(caption.includes(" · до "));
  });

  test("устаревшая: клиент не ответил", () => {
    const { title, caption } = locationRequestCaption(
      req({ expires_at: new Date(NOW - DAY).toISOString() }),
      NOW,
    );
    assert.equal(title, "Ссылка устарела");
    assert.ok(caption.startsWith("Клиент не ответил"));
  });

  test("shortDate переживает мусор", () => {
    assert.equal(shortDate("not a date"), "");
    assert.ok(shortDate("2026-09-07T12:00:00Z").length > 0);
  });
});
