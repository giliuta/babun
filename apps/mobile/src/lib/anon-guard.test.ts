import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { anonymousRequestError, isAnonymousDataRequest } from "./anon-guard";

// ЗАПРОС К ДАННЫМ БЕЗ ТОКЕНА ВОШЕДШЕГО НЕ УХОДИТ (аудит 04.10). Минуту после
// неудачного обновления токена supabase-js шлёт запросы публичным ключом, и
// RLS отвечает анониму «200, пусто»: сверка стирала кэш календаря, перенос
// записи убирал её как «удалённую», напоминания снимались.

const KEY = "sb_publishable_test";
const REST = "https://x.supabase.co/rest/v1/appointments?select=*";
const USER = "b311d04c-f85a-40ea-97d1-d84e2e8dbaaf";

describe("заслонка анонимного запроса", () => {
  test("вошёл, а запрос к строкам несёт публичный ключ — отбиваем", () => {
    assert.equal(
      isAnonymousDataRequest({
        url: REST,
        authorization: `Bearer ${KEY}`,
        publishableKey: KEY,
        signedInUserId: USER,
      }),
      true,
    );
  });

  test("функция без заголовка входа вовсе — тоже отбиваем", () => {
    assert.equal(
      isAnonymousDataRequest({
        url: "https://x.supabase.co/functions/v1/send_sms",
        authorization: null,
        publishableKey: KEY,
        signedInUserId: USER,
      }),
      true,
    );
  });

  test("токен человека — пропускаем", () => {
    assert.equal(
      isAnonymousDataRequest({
        url: REST,
        authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.user",
        publishableKey: KEY,
        signedInUserId: USER,
      }),
      false,
    );
  });

  test("не вошёл — публичные страницы без входа работают как раньше", () => {
    assert.equal(
      isAnonymousDataRequest({
        url: "https://x.supabase.co/rest/v1/rpc/appointment_link_lookup",
        authorization: `Bearer ${KEY}`,
        publishableKey: KEY,
        signedInUserId: null,
      }),
      false,
    );
  });

  test("вход и обновление токена — мимо заслонки", () => {
    assert.equal(
      isAnonymousDataRequest({
        url: "https://x.supabase.co/auth/v1/token?grant_type=refresh_token",
        authorization: `Bearer ${KEY}`,
        publishableKey: KEY,
        signedInUserId: USER,
      }),
      false,
    );
  });

  test("отказ — та же ошибка, что у RN-fetch без сети", () => {
    const err = anonymousRequestError();
    assert.ok(err instanceof TypeError);
    assert.equal(err.message, "Network request failed");
  });
});

describe("клиент Supabase зовёт заслонку до отправки", () => {
  const source = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "supabase.ts"),
    "utf8",
  );

  test("заслонка стоит в общем fetch, раньше любого fetch(...)", () => {
    const body = source.slice(source.indexOf("function fetchWithActiveTenant("));
    const guard = body.indexOf("isAnonymousDataRequest(");
    const firstFetch = body.search(/\breturn fetch\(/);
    assert.ok(guard > 0, "заслонки нет в fetchWithActiveTenant");
    assert.ok(firstFetch > guard, "запрос уходит раньше заслонки");
    assert.match(body, /authorization: headers\.get\("Authorization"\)/);
    assert.match(body, /signedInUserId: getActiveUserId\(\)/);
  });
});
