import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

// ССЫЛКИ babun.app ОТКРЫВАЮТ ПРИЛОЖЕНИЕ — ПАРА «СБОРКА ↔ САЙТ».
//
// Сборка объявляет пути (`app.config.js`: `intentFilters` с `autoVerify` у
// Android, `associatedDomains` у iOS), а телефон верит ей, только если сайт
// подтверждает её файлом в `public/.well-known`. Без `assetlinks.json` Android
// открывал приглашения и вход в браузере. Разойтись пара может молча: другой
// package, путь без пары, сайт, переписавший `/.well-known` на index.html.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const APP = JSON.parse(read("apps/mobile/app.json")) as {
  expo: { android: { package: string }; ios: { bundleIdentifier: string } };
};
const CONFIG = read("apps/mobile/app.config.js");
const ASSET_LINKS = JSON.parse(read("apps/mobile/public/.well-known/assetlinks.json")) as {
  relation: string[];
  target: { namespace: string; package_name: string; sha256_cert_fingerprints: string[] };
}[];
const AASA = JSON.parse(read("apps/mobile/public/.well-known/apple-app-site-association")) as {
  applinks: { details: { appIDs: string[]; paths: string[] }[] };
};
const VERCEL = read("vercel.json");

const appLinkPaths = (): string[] => {
  const m = /const APP_LINK_PATHS = (\[[^\]]*\])/.exec(CONFIG);
  assert.ok(m, "в app.config.js нет APP_LINK_PATHS");
  return JSON.parse(m[1]) as string[];
};

// Отпечаток — 32 байта «AA:BB:…». Пока владелец его не вписал, стоит
// заглушка с подсказкой, где взять; файл с ней безвреден — проверка ссылок
// просто не проходит, как и без файла.
const FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;
const PLACEHOLDER = /^[A-Z_0-9]+_SHA256_FROM_[A-Z_]+$/;

describe("Android: assetlinks.json подтверждает сборку", () => {
  test("тот же package, что у боевой сборки, и право открывать ссылки", () => {
    assert.equal(ASSET_LINKS.length, 1);
    const entry = ASSET_LINKS[0]!;
    assert.deepEqual(entry.relation, ["delegate_permission/common.handle_all_urls"]);
    assert.equal(entry.target.namespace, "android_app");
    assert.equal(entry.target.package_name, APP.expo.android.package);
  });

  test("отпечатки — настоящие SHA-256 или заглушка, без опечаток формата", () => {
    const prints = ASSET_LINKS[0]!.target.sha256_cert_fingerprints;
    assert.ok(prints.length > 0);
    for (const print of prints) assert.ok(FINGERPRINT.test(print) || PLACEHOLDER.test(print), print);
  });

  test("сборка просит проверку ссылок на babun.app", () => {
    assert.match(CONFIG, /autoVerify: true/);
    assert.match(CONFIG, /host: "babun\.app"/);
  });
});

describe("пути сборки и сайта совпадают", () => {
  test("каждый путь Android-ссылок есть и у Apple", () => {
    const apple = AASA.applinks.details.flatMap((d) => d.paths);
    // У Android путь — префикс (`pathPrefix`), у Apple — шаблон «/invite/*».
    for (const p of appLinkPaths()) {
      assert.ok(apple.includes(p) || apple.includes(`${p}/*`), `${p} нет в apple-app-site-association`);
    }
    const ids = AASA.applinks.details.flatMap((d) => d.appIDs);
    assert.ok(ids.some((id) => id.endsWith(`.${APP.expo.ios.bundleIdentifier}`)));
  });

  test("сайт отдаёт /.well-known файлом, а не страницей приложения", () => {
    assert.match(VERCEL, /\\\\\.well-known\//, "rewrite на index.html съел бы /.well-known");
    assert.match(VERCEL, /apple-app-site-association\|assetlinks\.json/);
  });
});
