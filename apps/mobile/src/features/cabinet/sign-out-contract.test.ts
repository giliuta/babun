import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// «ВЫЙТИ» — ТОЛЬКО С ЭТОГО УСТРОЙСТВА (владелец 2026-09-15: «чтоб ничего не
// повторялось»). Каждая «Выйти» в приложении шла через
// `signOutScopeAndWipe("global")`: выход на одном телефоне гасил сессии аккаунта
// на всех остальных, а «Выйти» и «Выйти со всех устройств» делали одно и то же.
// Глобальный выход остаётся одной явной строкой в «Вход и безопасность»,
// обычная «Выйти» — одна, внизу Кабинета.

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative: string) =>
  readFileSync(resolve(here, relative), "utf8");

/** Тело функции от объявления до закрывающей скобки в первой колонке. */
function functionBody(source: string, declaration: string): string {
  const from = source.indexOf(declaration);
  assert.notEqual(from, -1, `missing ${declaration}`);
  const to = source.indexOf("\n}\n", from);
  assert.notEqual(to, -1, `unterminated ${declaration}`);
  return source.slice(from, to);
}

describe("выход из аккаунта", () => {
  test("обычная «Выйти» гасит только сессию этого устройства", () => {
    const body = functionBody(
      read("../../lib/auth-clear.ts"),
      "export async function signOutAndWipe()",
    );
    assert.match(body, /signOutScopeAndWipe\("local"\)/);
    assert.doesNotMatch(body, /"global"/);
  });

  test("в «Вход и безопасность» нет второй «Выйти», выход со всех устройств — явной строкой", () => {
    const account = read("../../../app/(dashboard)/cabinet/account.tsx");
    assert.doesNotMatch(account, /\bsignOutAndWipe\b/);
    assert.match(account, /await signOutScopeAndWipe\("global"\)/);
  });
});
