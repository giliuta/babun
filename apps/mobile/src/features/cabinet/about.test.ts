import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { updateSummary, versionSummary } from "./about";

describe("versionSummary", () => {
  test("версия и номер сборки из TestFlight", () => {
    assert.equal(
      versionSummary({ displayVersion: "v1.8.28", buildNumber: "4" }),
      "v1.8.28 · сборка 4",
    );
  });

  test("без номера сборки — одна версия", () => {
    assert.equal(versionSummary({ displayVersion: "v1.8.28", buildNumber: null }), "v1.8.28");
    assert.equal(versionSummary({ displayVersion: "v1.8.28", buildNumber: " " }), "v1.8.28");
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
