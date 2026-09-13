import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@babun/shared/db/database.types";
import { BOUND_TENANT_FIELD } from "@babun/shared/sync/replayer";

import { bindTenant } from "./bind-tenant";
import { TENANT_HEADER } from "./tenant-header";

const B = "11365a87-bef9-4f6c-a030-b15083fe646b";

/** Настоящий supabase-js поверх поддельного fetch, который только записывает,
 *  с каким заголовком ушёл запрос. Проверяем ПОЕЗДКУ, а не наш объект. */
function clientRecordingHeaders() {
  const seen: { url: string; tenant: string | null }[] = [];
  const fetchSpy: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers ?? {});
    seen.push({
      url: typeof input === "string" ? input : (input as Request).url,
      tenant: headers.get(TENANT_HEADER),
    });
    return new Response("[]", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const client = createClient<Database>("https://x.supabase.co", "anon-key", {
    global: { fetch: fetchSpy },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { client, seen };
}

describe("клиент, привязанный к одной компании", () => {
  test("from → select → eq → order → range уходит с заголовком компании", async () => {
    const { client, seen } = clientRecordingHeaders();
    const bound = bindTenant(client, B);
    await bound
      .from("appointments")
      .select("id")
      .eq("tenant_id", B)
      .order("date")
      .range(0, 9);
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.tenant, B);
  });

  test("два фильтра подряд — заголовок не теряется по дороге", async () => {
    const { client, seen } = clientRecordingHeaders();
    await bindTenant(client, B).from("clients").select("id").eq("id", "c-1").eq("phone", "+357");
    assert.equal(seen[0]?.tenant, B);
  });

  test("rpc тоже называет компанию", async () => {
    const { client, seen } = clientRecordingHeaders();
    await bindTenant(client, B).rpc("current_user_role");
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.tenant, B);
  });

  test("объявляет себя привязанным — очередь через него не выгружает", () => {
    // Сам отказ живёт в `sync/replayer.ts` и проверяется его тестами; здесь —
    // что вид ставит поле, по которому очередь его узнаёт.
    const bound = bindTenant(clientRecordingHeaders().client, B) as unknown as Record<string, unknown>;
    assert.equal(bound[BOUND_TENANT_FIELD], B);
  });

  test("auth, storage и channel не выдаются: они живут по токену", () => {
    const bound = bindTenant(clientRecordingHeaders().client, B) as unknown as Record<string, unknown>;
    for (const property of ["auth", "storage", "channel", "removeChannel"]) {
      assert.throws(() => bound[property], /только from и rpc/);
    }
  });
});
