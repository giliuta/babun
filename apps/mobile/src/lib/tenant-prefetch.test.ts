import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

// СТОРОЖ: ПРОГРЕВ ЧУЖОЙ КОМПАНИИ — ТОЛЬКО В ПАМЯТЬ.
//
// `tenant-prefetch.ts` тянет react-native, и под раннером не поднимается;
// проверить его поведение можно только по исходнику. Это честная проверка
// ровно одного свойства — какие имена в модуле ЕСТЬ и каких НЕТ, — и она
// уже ловила бы каждую из известных протечек: валюта B на экране A
// (`setDefaultCurrency`), настройки B под общим ключом MMKV
// (`safeSave…`), SQLite-снимок B (`cacheReplaceTenant`), слив очереди под
// чужим заголовком (`kickReplayer`), ложная «свежесть» активной компании
// (`emitRevalidated`).
//
// Условие сессии 005 при передаче файлов: «побочные эффекты — тест в обе
// стороны». Обе стороны здесь: у активной компании побочное действие ОСТАЁТСЯ
// в хуке; у прогрева его НЕТ.

const here = __dirname;

/** Комментарии из проверки исключаются: они как раз и называют то, чего в
 *  коде быть не должно. Сторож смотрит на код. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

const read = (rel: string) =>
  stripComments(readFileSync(join(here, rel), "utf8"));

const FORBIDDEN_IN_PREFETCH = [
  "setDefaultCurrency",
  "safeSaveCalendarSettings",
  "safeSaveOperationalCalendarSettings",
  "cacheReplaceTenant",
  "kickReplayer",
  "emitRevalidated",
  "getStorage(",
  "setActiveTenantId",
  "activate_tenant",
  // Офлайн-обёртки: они пишут SQLite и будят очередь.
  "sync/appointmentsCached",
  "sync/clientsCached",
  "sync/tagsCached",
];

describe("прогрев чужой компании не имеет побочных действий", () => {
  const prefetch = read("tenant-prefetch.ts");
  const fetchers = read("../features/settings/company-fetchers.ts");

  test("исполнитель прогрева не зовёт ничего из запрещённого списка", () => {
    for (const name of FORBIDDEN_IN_PREFETCH) {
      assert.ok(!prefetch.includes(name), `в tenant-prefetch.ts есть «${name}»`);
    }
  });

  test("чистые чтения тоже", () => {
    for (const name of FORBIDDEN_IN_PREFETCH) {
      assert.ok(!fetchers.includes(name), `в company-fetchers.ts есть «${name}»`);
    }
  });

  test("греет привязанным клиентом, а ленту читает обычным", () => {
    assert.ok(prefetch.includes("tenantBoundClient(tenantId)"));
    assert.ok(prefetch.includes("fetchMyCalendars(supabase)"));
  });

  test("обратная сторона: у активной компании побочные действия на месте", () => {
    const tenantHook = read("../features/settings/tenant.ts");
    const settingsHook = read("../features/settings/local-settings.ts");
    assert.ok(tenantHook.includes("setDefaultCurrency(profile?.currency)"));
    assert.ok(settingsHook.includes("safeSaveCalendarSettings(settings)"));
    assert.ok(settingsHook.includes("safeSaveOperationalCalendarSettings("));
  });
});
