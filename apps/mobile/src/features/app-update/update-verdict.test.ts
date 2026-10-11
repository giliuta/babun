import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { compareVersions, updateVerdict } from "./update-verdict";

describe("вышло обновление", () => {
  test("версии сравниваются по числам", () => {
    assert.equal(compareVersions("1.0.10", "1.0.9"), 1);
    assert.equal(compareVersions("1.0", "1.0.0"), 0);
    assert.equal(compareVersions("1.0.2", "1.0.3"), -1);
  });

  test("ниже последней — плашка, ниже минимальной — не пускаем", () => {
    assert.equal(updateVerdict({ current: "1.0.2", latest: "1.0.3", min: "0.0.0" }), "soft");
    assert.equal(updateVerdict({ current: "1.0.2", latest: "1.0.3", min: "1.0.3" }), "force");
    assert.equal(updateVerdict({ current: "1.0.3", latest: "1.0.3", min: "1.0.0" }), "none");
    assert.equal(updateVerdict({ current: "1.0.4", latest: "1.0.3", min: "1.0.0" }), "none");
  });

  test("версия сборки неизвестна — молчим", () => {
    assert.equal(updateVerdict({ current: null, latest: "9.9.9", min: "9.9.9" }), "none");
  });
});

test("сторож: проверка стоит над всеми маршрутами", async () => {
  const { readFileSync } = await import("node:fs");
  const { dirname, resolve } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const here = dirname(fileURLToPath(import.meta.url));
  const root = readFileSync(resolve(here, "../../../app/_layout.tsx"), "utf8");
  assert.match(root, /<AppUpdateGate>\s*<RootNavigator \/>\s*<\/AppUpdateGate>/);
  const gate = readFileSync(resolve(here, "AppUpdateGate.tsx"), "utf8");
  assert.match(gate, /\.from\("app_release"\)/);
});
