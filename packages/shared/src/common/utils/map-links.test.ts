import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMapUrl, isTrustedMapUrl } from "./map-links";

test("ссылки карт — свои, с короткими и без схемы", () => {
  for (const url of [
    "https://maps.app.goo.gl/JhNhFkSbDNRy",
    "maps.app.goo.gl/JhNhFkSbDNRy",
    "https://goo.gl/maps/abc",
    "https://www.google.com/maps/place/x/@34.7,33.0,17z",
    "https://www.google.com.cy/maps?q=34.7,33.0",
    "https://maps.apple.com/place?ll=34.7,33.0",
    "HTTPS://WAZE.COM/ul?ll=34.7,33.0",
    "https://yandex.ru/maps/-/CDaBc",
  ]) {
    assert.equal(isTrustedMapUrl(url), true, url);
  }
});

test("чужая страница под видом карты — не карта", () => {
  for (const url of [
    "https://evil.com/maps",
    "https://google.com.evil.com/maps",
    "https://maps.google.com@evil.com/",
    "https://www.google.com/search?q=maps",
    "https://goo.gl/abc",
    "javascript:alert(1)",
    "https://evil.com\\maps.apple.com",
    "Agios Tychonas 21, Limassol",
  ]) {
    assert.equal(isTrustedMapUrl(url), false, url);
  }
});

test("Google открывает как есть только ссылку карты, чужую — ищет", () => {
  assert.equal(buildMapUrl("google", "https://maps.app.goo.gl/abc"), "https://maps.app.goo.gl/abc");
  assert.equal(
    buildMapUrl("google", "https://evil.com/x"),
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent("https://evil.com/x")}`,
  );
});
