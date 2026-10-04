import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { isAuthRequest, isRefreshConflict, retryableAuthResponse } from "./auth-fetch";

const BASE = "https://example.supabase.co";
const REFRESH = `${BASE}/auth/v1/token?grant_type=refresh_token`;
const PASSWORD = `${BASE}/auth/v1/token?grant_type=password`;

describe("вход переживает лежащий сервер (01.10)", () => {
  test("служба входа — без нашего потолка; строки и функции — с ним", () => {
    assert.equal(isAuthRequest(REFRESH), true);
    assert.equal(isAuthRequest(`${BASE}/auth/v1/user`), true);
    assert.equal(isAuthRequest(`${BASE}/rest/v1/rpc/current_user_role`), false);
    assert.equal(isAuthRequest(`${BASE}/rest/v1/clients?select=id`), false);
    assert.equal(isAuthRequest("не адрес"), false);
  });

  test("409 на обновлении — временный; на входе по паролю и других — как есть", () => {
    assert.equal(isRefreshConflict(REFRESH, 409), true);
    assert.equal(isRefreshConflict(REFRESH, 400), false, "ключ уже использован — выход честный");
    assert.equal(isRefreshConflict(PASSWORD, 409), false);
    assert.equal(isRefreshConflict(`${BASE}/rest/v1/clients`, 409), false);
  });

  test("ответ 409 обновления уходит библиотеке как 503 с тем же телом", async () => {
    const body = JSON.stringify({ code: 409, error_code: "conflict" });
    const shimmed = await retryableAuthResponse(REFRESH, new Response(body, { status: 409 }));
    assert.equal(shimmed.status, 503);
    assert.equal(await shimmed.text(), body);
    const untouched = new Response("{}", { status: 409 });
    assert.equal(await retryableAuthResponse(PASSWORD, untouched), untouched);
  });
});
