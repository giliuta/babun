import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { onStorageReady } from "@babun/shared/storage";

// ХОЛОДНЫЙ СТАРТ БЕЗ СЕРВЕРА (03.10 вечер, на лежащей базе). Шапка вкладок
// с устройства (`chrome-cache`) поднималась прямым вызовом при загрузке
// `query-client.ts`. Но Expo Router вычисляет файлы маршрутов по алфавиту:
// `app/(auth)/_layout.tsx` раньше корневого `app/_layout.tsx`, а через него —
// сессия → чистка → кэш запросов. Хранилище подключает корневой макет
// (`bootstrap.ts`), то есть ПОЗЖЕ: чтение бросало, глоталось, «поднято 0».
// Каждый холодный старт без сети упирался в стену «Нет связи с сервером»
// без вкладок — ровно то, что владелец просил убрать. В логе живого
// приложения: «No KVStorage configured» → «restored 0».

const MOBILE = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(MOBILE, rel), "utf8");

describe("chrome cache on a cold start", () => {
  test("the route that loads first sorts before the root layout", () => {
    // Сама причина: группа в скобках идёт раньше `_layout` — если порядок
    // когда-нибудь сменится, этот тест скажет, что защита больше не нужна.
    const entries = readdirSync(path.join(MOBILE, "app")).sort();
    assert.ok(entries.indexOf("(auth)") < entries.indexOf("_layout.tsx"));
  });

  test("query-client restores the chrome only once storage is bound", () => {
    const src = read("src/lib/query-client.ts").replace(/\/\/.*$/gm, "");
    const calls = [...src.matchAll(/restoreChrome\(/g)].length;
    assert.equal(calls, 1, "one restore call");
    assert.match(src, /onStorageReady\(\s*\(\)\s*=>\s*restoreChrome\(queryClient\)\s*\)/);
  });

  test("setStorage flushes what waited for it", () => {
    const src = readFileSync(
      path.resolve(MOBILE, "../../packages/shared/src/storage/provider.ts"),
      "utf8",
    );
    const body = src.slice(src.indexOf("export function setStorage"), src.indexOf("}", src.indexOf("export function setStorage")));
    assert.match(body, /_onReady\.splice\(0\)/);
  });

  test("off native the work runs at once", () => {
    let ran = false;
    onStorageReady(() => {
      ran = true;
    });
    assert.equal(ran, true);
  });
});
