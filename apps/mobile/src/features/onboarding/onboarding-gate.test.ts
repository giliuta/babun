import assert from "node:assert/strict";
import { test } from "node:test";
import { onboardingServerReady } from "./onboarding-gate";

const store = (runtimeVersion: string | null) =>
  onboardingServerReady({ platform: "ios", dev: false, runtimeVersion, configVersion: "1.0.4" });

test("сборка из магазина: решает версия натива, не код по воздуху", () => {
  assert.equal(store("1.0.3"), false);
  assert.equal(store("1.0.4"), true);
  assert.equal(store("1.0.10"), true);
  assert.equal(store("1.1.0"), true);
  assert.equal(store(null), false);
});

test("dev-клиент смотрит версию из app.json", () => {
  const dev = (configVersion: string) =>
    onboardingServerReady({ platform: "ios", dev: true, runtimeVersion: null, configVersion });
  assert.equal(dev("1.0.3"), false);
  assert.equal(dev("1.0.4"), true);
});

test("веб пока без обучения", () => {
  assert.equal(
    onboardingServerReady({ platform: "web", dev: false, runtimeVersion: "1.0.4", configVersion: "1.0.4" }),
    false,
  );
});
