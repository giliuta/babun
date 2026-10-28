import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { bundleIdOf, isNewBuild, runningBundleId } from "./web-build";

const here = dirname(fileURLToPath(import.meta.url));
const read = (name: string) => readFileSync(resolve(here, name), "utf8");

const html = (id: string) =>
  `<!doctype html><html><head></head><body><div id="root"></div><script src="/_expo/static/js/web/${id}.js" defer></script></body></html>`;

describe("веб: новая сборка сайта — по имени бандла", () => {
  test("имя бандла берётся из разметки и из скриптов вкладки", () => {
    assert.equal(bundleIdOf(html("entry-d722eb7f7855366f71aa9a4bbc982f65")), "entry-d722eb7f7855366f71aa9a4bbc982f65");
    assert.equal(bundleIdOf("<html>Ошибка 502</html>"), null);
    assert.equal(
      runningBundleId([{ src: "https://babun.app/og.js" }, { src: "https://babun.app/_expo/static/js/web/entry-abc123.js" }]),
      "entry-abc123",
    );
  });

  test("Metro в разработке — бандл без хэша, проверка молчит", () => {
    assert.equal(runningBundleId([{ src: "http://localhost:8081/node_modules/expo-router/entry.bundle?platform=web" }]), null);
    assert.equal(isNewBuild(null, "entry-abc"), false);
  });

  test("новая — только другое имя; пустой ответ сети новой версией не считается", () => {
    assert.equal(isNewBuild("entry-aaa", "entry-bbb"), true);
    assert.equal(isNewBuild("entry-aaa", "entry-aaa"), false);
    assert.equal(isNewBuild("entry-aaa", null), false);
  });

  test("проводка: только веб, сверка при фокусе и по таймеру, перезагрузка лишь по кнопке", () => {
    const bar = read("WebUpdateBar.tsx");
    assert.match(bar, /if \(Platform\.OS !== "web"/);
    assert.match(bar, /addEventListener\("visibilitychange", check\)/);
    assert.match(bar, /addEventListener\("focus", check\)/);
    assert.match(bar, /setInterval\(check, WEB_BUILD_CHECK_MS\)/);
    assert.match(bar, /cache: "no-store"/);
    // Перезагрузка — единственная, и только в кнопке плашки.
    assert.equal(bar.match(/location\.reload\(\)/g)?.length, 1);
    assert.match(bar, /action=\{\{ label: "Обновить", onPress: \(\) => window\.location\.reload\(\) \}\}/);
    // Обёртка стоит всегда: появление плашки не пересоздаёт приложение.
    assert.doesNotMatch(bar, /if \(!fresh\) return/);
    const gate = read("AppUpdateGate.tsx");
    assert.match(gate, /Platform\.OS === "web"\) return <WebUpdateShell>\{children\}<\/WebUpdateShell>/);
  });
});
