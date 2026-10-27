import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { Session } from "@supabase/supabase-js";

import { shouldPublishSession, signedOutNow } from "./session-publish";

const here = dirname(fileURLToPath(import.meta.url));

function session(patch: {
  id?: string;
  token?: string;
  tenant?: string;
  name?: string;
}): Session {
  return {
    access_token: patch.token ?? "t1",
    user: {
      id: patch.id ?? "user-1",
      email: "airfix@example.com",
      app_metadata: { tenant_id: patch.tenant ?? "tenant-a" },
      user_metadata: { name: patch.name ?? "Артем" },
    },
  } as unknown as Session;
}

describe("публикация сессии", () => {
  test("обновлённый токен того же человека дерево не перерисовывает", () => {
    assert.equal(
      shouldPublishSession(
        "TOKEN_REFRESHED",
        session({ token: "t1" }),
        session({ token: "t2" }),
      ),
      false,
    );
  });

  test("токен догнал компанию — публикуется: это запасной путь useTenantId", () => {
    assert.equal(
      shouldPublishSession(
        "TOKEN_REFRESHED",
        session({ tenant: "tenant-a" }),
        session({ tenant: "tenant-b" }),
      ),
      true,
    );
  });

  test("другой человек, другие метаданные, другое событие, пустая сессия — публикуются", () => {
    assert.equal(
      shouldPublishSession("TOKEN_REFRESHED", session({}), session({ id: "user-2" })),
      true,
    );
    assert.equal(
      shouldPublishSession("TOKEN_REFRESHED", session({}), session({ name: "Дмитрий" })),
      true,
    );
    assert.equal(shouldPublishSession("SIGNED_IN", session({}), session({})), true);
    assert.equal(shouldPublishSession("TOKEN_REFRESHED", null, session({})), true);
    assert.equal(shouldPublishSession("TOKEN_REFRESHED", session({}), null), true);
  });

  test("SessionProvider спрашивает это правило перед setSession", () => {
    const source = readFileSync(resolve(here, "SessionProvider.tsx"), "utf8");
    assert.match(
      source,
      /setSession\(\(prev\) =>\s*shouldPublishSession\(event, prev, next\) \? next : prev,?\s*\)/,
    );
  });
});

describe("выход гасит повторы запросов", () => {
  test("только переход «был человек → никого»", () => {
    assert.equal(signedOutNow("user-1", null), true);
    assert.equal(signedOutNow(null, null), false, "холодный старт без входа: публичные страницы грузятся");
    assert.equal(signedOutNow(null, "user-1"), false);
    assert.equal(signedOutNow("user-1", "user-2"), false, "смену человека чистит handleAuthEvent");
    assert.equal(signedOutNow("user-1", "user-1"), false);
  });

  test("SessionProvider гасит запросы на этом переходе, после снятия заслонки", () => {
    const source = readFileSync(resolve(here, "SessionProvider.tsx"), "utf8");
    const effect = source.slice(source.indexOf("setShownSessionUserId(shownUserId)"));
    assert.match(
      effect,
      /if \(signedOutNow\(shownBefore\.current, shownUserId\)\) \{\s*void queryClient\.cancelQueries\(\);/,
    );
  });
});
