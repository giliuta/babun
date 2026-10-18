import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { assertAnswerOfTenant } from "./tenant-match";

// РОЛЬ, ПРОФИЛЬ И СВОЯ КАРТА ПРАВ ЧИТАЮТСЯ ПОД КОМПАНИЕЙ КЛЮЧА.
//
// Ключ запроса называет компанию, а глобальный клиент берёт её заголовок из
// окружения в момент отправки. Замороженная вкладка прежней компании держит
// наблюдателя со старым ключом: после перехода его опрос уходил с НОВЫМ
// заголовком, и ответ чужой компании ложился под ключ прежней — роль, тариф и
// права одной компании показывались в другой при возврате. Хуки тянут
// react-native, поэтому форма вызовов проверяется по исходнику.

const here = __dirname;

function flat(rel: string): string {
  return readFileSync(join(here, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
    .replace(/\s+/g, " ");
}

describe("сессия читает под компанией ключа", () => {
  test("роль — привязанным клиентом", () => {
    const src = flat("tenant.ts");
    assert.match(src, /tenantBoundClient\(tenantId as string\)\.rpc\("current_user_role"\)/);
    assert.doesNotMatch(src, /supabase\.rpc\("current_user_role"\)/);
  });

  test("профиль — привязанным клиентом и только своей компании", () => {
    const src = flat("tenant.ts");
    assert.match(src, /fetchTenantProfile\( tenantBoundClient\(tenantId as string\),/);
    assert.match(src, /assertAnswerOfTenant\(profile\.id, tenantId\)/);
  });

  test("своя карта прав — привязанным клиентом и только своей компании", () => {
    const src = flat("access-queries.ts");
    const body = src.slice(src.indexOf("export function useMyAccess"));
    assert.match(body, /tenantBoundClient\(tenantId as string\)\.rpc\("my_access_map"\)/);
    const check = body.indexOf("assertAnswerOfTenant(next.tenantId, tenantId)");
    const sideEffects = body.indexOf("lostAccess(");
    assert.ok(check >= 0, "ответ чужой компании не отбрасывается");
    assert.ok(check < sideEffects, "сверка — до стирания данных по карте");
  });

  test("валюта — эффектом от профиля активной компании, не в чтении", () => {
    const src = flat("tenant.ts");
    const useTenantBody = src.slice(
      src.indexOf("export function useTenant()"),
      src.indexOf("export function useActiveCurrency"),
    );
    assert.doesNotMatch(useTenantBody, /setDefaultCurrency/);
    assert.match(
      src,
      /useEffect\(\(\) => \{ setDefaultCurrency\(profile\?\.currency\); \}, \[profile\?\.currency\]\)/,
    );
    const providers = flat("../providers/AppProviders.tsx");
    assert.match(providers, /<ActiveCurrencyMount \/>/);
  });

  test("переход ставит валюту прогретого профиля до смены компании", () => {
    const src = flat("switch-tenant.ts");
    const preset = src.indexOf("if (warmedProfile) setDefaultCurrency(warmedProfile.currency);");
    const flip = src.indexOf("setActiveTenantId(userId, tenantId)");
    assert.ok(preset >= 0 && preset < flip, "валюта ставится после смены компании");
    assert.match(src, /if \(!switched\) setDefaultCurrency\(currencyBefore\);/);
  });
});

describe("assertAnswerOfTenant", () => {
  test("своя компания проходит, чужая и пустая — нет", () => {
    assert.doesNotThrow(() => assertAnswerOfTenant("A", "A"));
    assert.throws(() => assertAnswerOfTenant("B", "A"));
    assert.throws(() => assertAnswerOfTenant("A", null));
    assert.throws(() => assertAnswerOfTenant(undefined, "A"));
  });
});
