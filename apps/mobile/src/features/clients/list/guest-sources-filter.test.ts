import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { clientsListSource } from "./source-for-tests";

// ИСТОЧНИКИ КОМПАНИИ-РАБОТОДАТЕЛЯ В ФИЛЬТРЕ ПАРТНЁРА. Гостевое чтение не
// грузило `client_sources`, и все клиенты работодателя падали в «Не указан»:
// фильтр «Источник» знал только свои источники. Учётки партнёра на
// симуляторе нет, поэтому сторож — по тексту.

const here = dirname(fileURLToPath(import.meta.url));
const guest = readFileSync(resolve(here, "../guest-sources.ts"), "utf8");

describe("фильтр «Источник» у партнёра", () => {
  test("гостевая компания читает свои источники", () => {
    assert.match(guest, /fetchClientSources\(tenantBoundClient\(tenantId\), tenantId\)/);
    assert.match(guest, /sources: \(queries\[at \+ 5\]/);
  });

  test("список склеивает их со своими и ждёт их перед прунингом", () => {
    const list = clientsListSource();
    assert.match(list, /uniqueById\(\[\.\.\.ownData, \.\.\.guestClientSources\]\)/);
    assert.match(list, /sourcesReady = sourcesQuery\.isSuccess && guestSourcesSettled/);
  });
});
