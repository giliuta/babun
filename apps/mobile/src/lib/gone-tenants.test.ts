import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  __resetGoneTenantsForTests,
  liveTenantId,
  markTenantGone,
} from "./gone-tenants";

// КОМПАНИЯ, ГДЕ ЧЕЛОВЕКА БОЛЬШЕ НЕТ, НЕ ДЕРЖИТ ЕГО НА «АККАУНТ НЕ НАСТРОЕН»
// (аудит 04.10). Партнёр вышел, его убрали из партнёров, он вошёл снова — и
// устройство и токен возвращали ту компанию, профиль приходил пустым, а
// «Повторить» и новый вход вели туда же.

const ME = "b311d04c-f85a-40ea-97d1-d84e2e8dbaaf";
const OTHER = "c311d04c-f85a-40ea-97d1-d84e2e8dbaaf";
const GONE = "11365a87-bef9-4f6c-a030-b15083fe646b";
const MINE = "2bc7907e-b149-44a9-92ff-a5e73403031c";

beforeEach(() => __resetGoneTenantsForTests());

describe("реестр ушедших компаний", () => {
  test("отмеченная компания у этого человека больше не резолвится", () => {
    markTenantGone(ME, GONE);
    assert.equal(liveTenantId(ME, GONE), null);
    assert.equal(liveTenantId(ME, MINE), MINE);
  });

  test("чужая отметка не действует", () => {
    markTenantGone(OTHER, GONE);
    assert.equal(liveTenantId(ME, GONE), GONE);
  });

  test("без человека или компании — null", () => {
    assert.equal(liveTenantId(null, MINE), null);
    assert.equal(liveTenantId(ME, null), null);
  });
});

describe("гейт компании забывает ушедшую и ищет живую", () => {
  const source = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "tenant.ts"),
    "utf8",
  );

  test("пустой профиль отмечает компанию ушедшей и снимает её с устройства", () => {
    assert.match(
      source,
      /if \(!tenant && userId && tenantId\) forgetGoneTenant\(qc, userId, tenantId\);/,
    );
    const helper = source.slice(source.indexOf("function forgetGoneTenant("));
    assert.match(helper, /markTenantGone\(userId, tenantId\)/);
    assert.match(helper, /qc\.removeQueries\(\{ queryKey: tenantMembershipKey\(userId\) \}\)/);
    assert.match(helper, /if \(getActiveTenantId\(\) === tenantId\) setActiveTenantId\(userId, null\)/);
  });

  test("токен и кэш с ушедшей компанией резолв пропускает", () => {
    assert.match(source, /const jwtTenantId = liveTenantId\(/);
    assert.match(source, /liveTenantId\(userId, readCache\(tenantIdCacheKey\(userId\)\)\)/);
  });

  test("найденная по членству компания закрепляется на устройстве без выбора", () => {
    assert.match(
      source,
      /if \(!getActiveTenantId\(\)\) setActiveTenantId\(userId as string, tenantId\);/,
    );
  });
});
