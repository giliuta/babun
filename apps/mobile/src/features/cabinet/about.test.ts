import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { shownVersion, updateSummary, versionSummary } from "./about";

describe("shownVersion", () => {
  test("на телефоне — версия магазина, а не внутренняя (06.10, выпуск в магазины)", () => {
    assert.equal(
      shownVersion({ web: false, storeVersion: "1.0.0", internalVersion: "v1.8.33" }),
      "1.0.0",
    );
  });

  test("на сайте — внутренняя, как раньше", () => {
    assert.equal(
      shownVersion({ web: true, storeVersion: "1.0.0", internalVersion: "v1.8.33" }),
      "v1.8.33",
    );
  });

  test("без версии магазина строка не остаётся пустой", () => {
    assert.equal(
      shownVersion({ web: false, storeVersion: undefined, internalVersion: "v1.8.33" }),
      "v1.8.33",
    );
    assert.equal(
      shownVersion({ web: false, storeVersion: " ", internalVersion: "v1.8.33" }),
      "v1.8.33",
    );
  });
});

describe("versionSummary", () => {
  test("версия и номер сборки — как в App Store и TestFlight", () => {
    assert.equal(
      versionSummary({ displayVersion: "1.0.0", buildNumber: "12" }),
      "1.0.0 · сборка 12",
    );
  });

  test("без номера сборки — одна версия", () => {
    assert.equal(versionSummary({ displayVersion: "1.0.0", buildNumber: null }), "1.0.0");
    assert.equal(versionSummary({ displayVersion: "1.0.0", buildNumber: " " }), "1.0.0");
  });
});

describe("updateSummary", () => {
  const now = new Date(2026, 8, 15, 12, 0).getTime();

  test("сборка разработки обновлений по воздуху не получает", () => {
    assert.equal(
      updateSummary({ enabled: false, embedded: true, createdAt: null }, now),
      "Недоступно в этой сборке",
    );
  });

  test("код из самой сборки", () => {
    assert.equal(
      updateSummary(
        { enabled: true, embedded: true, createdAt: new Date(2026, 8, 14, 23, 0) },
        now,
      ),
      "Версия из сборки",
    );
  });

  test("обновление по воздуху называет свой день и время", () => {
    assert.equal(
      updateSummary(
        { enabled: true, embedded: false, createdAt: new Date(2026, 8, 15, 1, 10) },
        now,
      ),
      "Обновлено 15 сентября в 01:10",
    );
    assert.equal(
      updateSummary(
        { enabled: true, embedded: false, createdAt: new Date(2025, 11, 31, 23, 5) },
        now,
      ),
      "Обновлено 31 декабря 2025 в 23:05",
    );
  });

  test("обновление без даты не выдумывает её", () => {
    assert.equal(
      updateSummary({ enabled: true, embedded: false, createdAt: null }, now),
      "Версия из сборки",
    );
  });
});
