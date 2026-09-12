import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { MemoryKVStorage, setStorage } from "@babun/shared/storage";

import {
  TENANT_SCOPED_KEY_PREFIXES,
  devicePrefKey,
  isTenantScopedKey,
  tenantPrefKey,
} from "./tenant-prefs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../../..");

const TENANT = "2bc7907e-b149-44a9-92ff-a5e73403031c";
const OTHER = "11365a87-bef9-4f6c-a030-b15083fe646b";

describe("настройки, помнящиеся по компании", () => {
  test("ключ называет компанию, поэтому чужая его не прочитает", () => {
    assert.notEqual(tenantPrefKey("calendar.view", TENANT),
                    tenantPrefKey("calendar.view", OTHER));
    assert.ok(tenantPrefKey("calendar.view", TENANT).includes(TENANT));
  });

  test("общая на все компании настройка заводится ОТДЕЛЬНЫМ именем", () => {
    // Смысл проверки не в строке, а в том, что «общая» — это решение, а не
    // забытый аргумент: у `tenantPrefKey` компания обязательна по типу, и
    // единственный способ обойтись без неё — назвать `devicePrefKey` вслух.
    assert.notEqual(devicePrefKey("hint"), tenantPrefKey("hint", TENANT));
    assert.ok(isTenantScopedKey(devicePrefKey("hint")));
  });

  test("переход бережёт ключи с компанией и сносит ключи без неё", () => {
    assert.ok(isTenantScopedKey(tenantPrefKey("calendar.view", TENANT)));
    assert.ok(isTenantScopedKey(`babun-contact-ways:${TENANT}`));
    assert.ok(isTenantScopedKey(`babun-booking-blocks:${TENANT}:order`));
    // А это — ключи без компании: их переход обязан снести, иначе настройка
    // одной фирмы будет прочитана как настройка другой.
    assert.ok(!isTenantScopedKey("calendar.view"));
    assert.ok(!isTenantScopedKey("babun-chats"));
    assert.ok(!isTenantScopedKey("babun-clients-sort"));
    // РЕЕСТР НАПОМИНАНИЙ переживает переход, хотя компанию не называет: он
    // принадлежит ЧЕЛОВЕКУ и хранит напоминания обеих компаний. Снося его,
    // переход заставлял сверку погасить выставленные руками напоминания обеих.
    assert.ok(isTenantScopedKey("babun:notifications:logical.v1"));
  });

  test("ЧИСТКА ВЖИВУЮ: переход бережёт настройку компании, выход из аккаунта — нет", () => {
    // Проверка не формы кода, а поведения: подставляем настоящий шов хранилища
    // и смотрим, что именно остаётся после подмёта. Логика подмёта повторена
    // здесь дословно (три условия из `wipeFastStores`), потому что сама функция
    // тянет за собой supabase, уведомления и react-query — в юнит-тесте им
    // делать нечего. Что чистка зовёт РЕАЛЬНО этот же реестр, сторожит
    // отдельный тест ниже.
    const TENANT_PREFIXES = ["babun-", "babun2:", "babun:", "calendar."];
    const KEEP_KEYS = new Set(["babun:auth:last-user-id"]);
    const KEEP_PREFIXES = ["babun:auth:active-tenant:"];

    const sweep = (keepTenantNamedKeys: boolean) => {
      const storage = new MemoryKVStorage();
      setStorage(storage);
      storage.set(tenantPrefKey("calendar.view", TENANT), { mode: "day" });
      storage.set(`babun-contact-ways:${TENANT}`, ["call"]);
      storage.set("calendar.view", { mode: "week" });
      storage.set("babun-chats", ["чужое"]);
      storage.setRaw("babun:auth:last-user-id", "user-1");

      for (const key of storage.list()) {
        if (KEEP_KEYS.has(key)) continue;
        if (KEEP_PREFIXES.some((p) => key.startsWith(p))) continue;
        if (keepTenantNamedKeys && isTenantScopedKey(key)) continue;
        if (TENANT_PREFIXES.some((p) => key.startsWith(p))) storage.remove(key);
      }
      return storage;
    };

    // ПЕРЕХОД В ДРУГУЮ КОМПАНИЮ.
    const afterSwitch = sweep(true);
    assert.deepEqual(
      afterSwitch.get(tenantPrefKey("calendar.view", TENANT)),
      { mode: "day" },
      "настройка, называющая компанию, обязана пережить переход",
    );
    assert.deepEqual(afterSwitch.get(`babun-contact-ways:${TENANT}`), ["call"]);
    // А безымянные — уходят, иначе они будут прочитаны как настройка новой.
    assert.equal(afterSwitch.get("calendar.view"), null);
    assert.equal(afterSwitch.get("babun-chats"), null);
    assert.equal(afterSwitch.getRaw("babun:auth:last-user-id"), "user-1");

    // ВЫХОД ИЗ АККАУНТА: на общем телефоне не остаётся ничего.
    const afterSignOut = sweep(false);
    assert.equal(afterSignOut.get(tenantPrefKey("calendar.view", TENANT)), null);
    assert.equal(afterSignOut.get(`babun-contact-ways:${TENANT}`), null);
    assert.equal(
      afterSignOut.getRaw("babun:auth:last-user-id"),
      "user-1",
      "штамп человека переживает и выход — по нему узнаётся смена аккаунта",
    );
  });

  test("чистка при переходе спрашивает реестр, а не свой список", () => {
    const authClear = readFileSync(resolve(here, "auth-clear.ts"), "utf8");
    assert.match(authClear, /isTenantScopedKey\(key\)/);
    // Второй список тех же префиксов внутри чистки разойдётся с реестром на
    // первой же правке — именно так в продукте и заводятся две правды.
    for (const prefix of TENANT_SCOPED_KEY_PREFIXES) {
      assert.ok(
        !authClear.includes(`"${prefix}"`),
        `префикс ${prefix} продублирован в auth-clear вместо реестра`,
      );
    }
  });

  test("РЕЕСТР НЕ ПРОТУХ: каждый ключ с компанией в имени объявлен", () => {
    // Сторож против главного способа сломать это правило — завести новый ключ
    // с `${tenantId}` и забыть строку в реестре. Тогда он молча вернётся к
    // прежнему поведению: будет сноситься на каждом переходе, и «настройка не
    // сохраняется» придётся искать заново.
    //
    // Обход и разбор — здесь, а не через `grep` в оболочке: первая версия
    // сторожа шла через `grep -E`, где `{` и `}` значат интервал, и ловила
    // РОВНО НИЧЕГО. Проверено снятием строки из реестра: тест остался зелёным.
    const found = new Map<string, string>();

    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = resolve(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules") continue;
          walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name)) continue;
        if (entry.name.includes(".test.")) continue;
        if (entry.name === "tenant-prefs.ts") continue;

        const src = readFileSync(full, "utf8");
        const rel = full.slice(repo.length + 1);

        // Форма 1: ключ собирается строкой — `babun-что-то:${tenantId}`.
        for (const m of src.matchAll(/`([A-Za-z0-9:._-]+):\$\{tenantId\}/g)) {
          found.set(m[1], rel);
        }
        // Форма 2: набор `createEnabledPrefs`, который приклеивает компанию сам.
        for (const m of src.matchAll(/storageKey:\s*"([A-Za-z0-9:._-]+)"/g)) {
          found.set(m[1], rel);
        }
      }
    };

    walk(resolve(repo, "apps/mobile/src"));
    walk(resolve(repo, "packages/shared/src"));

    assert.ok(found.size >= 4, "разбор перестал находить ключи — сторож ослеп");

    // Компанию в имени носят не только ключи хранилища: `tenant:${tenantId}` —
    // это имя realtime-канала, и чистки оно не касается вовсе. Сужаем ровно до
    // тех префиксов, которые чистка подметает (`TENANT_PREFIXES` в auth-clear),
    // иначе сторож начнёт требовать регистрации того, что хранилищем не является.
    const WIPED_PREFIXES = ["babun-", "babun2:", "babun:", "calendar."];

    const unregistered = [...found]
      .filter(([prefix]) => WIPED_PREFIXES.some((p) => prefix.startsWith(p)))
      .filter(([prefix]) => !TENANT_SCOPED_KEY_PREFIXES.some((p) => prefix.startsWith(p)))
      .map(([prefix, file]) => `${prefix} (${file})`);

    assert.deepEqual(
      unregistered,
      [],
      "ключ называет компанию, но не объявлен в TENANT_SCOPED_KEY_PREFIXES — " +
        "переход будет сносить его молча:\n" + unregistered.join("\n"),
    );
  });
});
