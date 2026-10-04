import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { roleLookupUnanswered } from "./role-unanswered";

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative: string) => readFileSync(resolve(here, relative), "utf8");

// Владелец 03.10, на зависшем сервере: вкладки висели загрузкой, карточка
// писала «Доступ не подтверждён», хотя роль была известна.

describe("сервер не ответил или отказал", () => {
  test("нет ответа: время вышло, нет сети, упал сервер или шлюз", () => {
    assert.equal(roleLookupUnanswered({ thrown: true }), true);
    assert.equal(roleLookupUnanswered({ status: 0 }), true);
    assert.equal(roleLookupUnanswered({ status: null }), true);
    for (const status of [500, 502, 503, 504, 522, 524]) {
      assert.equal(roleLookupUnanswered({ status }), true, String(status));
    }
  });

  test("отказ — это ответ: прав нет или сессия чужая", () => {
    for (const status of [400, 401, 403, 404, 409]) {
      assert.equal(roleLookupUnanswered({ status }), false, String(status));
    }
  });
});

describe("проводка: без сервера шапка на месте, тело говорит «нет связи»", () => {
  test("опрос роли без ответа оставляет известную роль, отказ — ошибка", () => {
    const tenant = read("tenant.ts");
    assert.match(tenant, /if \(known && roleLookupUnanswered\(\{ thrown: true \}\)\) return known;/);
    assert.match(tenant, /if \(known && roleLookupUnanswered\(\{ status \}\)\) return known;\s*throw new Error\(error\.message\);/);
  });

  test("шапка поднимается с устройства до первого экрана", () => {
    const client = read("../../lib/query-client.ts");
    // Поднимается, КОГДА хранилище подключено: модуль грузится раньше него
    // (разбор — chrome-cache-cold-start.test.ts).
    assert.match(client, /onStorageReady\(\(\) => restoreChrome\(queryClient\)\);\s*watchChrome\(queryClient\);/);
  });

  test("«Финансы»: лента команд и при загрузке, и при ошибке", () => {
    const finances = read("../../../app/(dashboard)/finances/index.tsx");
    assert.match(finances, /\{header\}\s*\{scopeBar\(false\)\}\s*<EmptyState state="loading" fill \/>/);
    assert.match(finances, /\{header\}\s*\{scopeBar\(true\)\}\s*<EmptyState/);
  });

  test("«Клиенты»: компании не едут — «Нет связи», а не вечная загрузка", () => {
    const gate = read("../clients/ClientsCompanyRoute.tsx");
    assert.match(gate, /decision\.state === "wait" && sources\.failed/);
    assert.match(read("../clients/sources.ts"), /const failed = membershipsQuery\.isError && memberships === undefined;/);
  });
});
