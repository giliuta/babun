import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { MemoryKVStorage, setStorage } from "@babun/shared/storage";
import {
  forgetActiveTenantId,
  getSignedInUserId,
  restoreActiveTenantId,
  setShownSessionUserId,
} from "./active-tenant";
import { LABEL_FALLBACK_COLOR } from "@/features/calendar/day-label";

// ВЫШЕЛ И ВОШЁЛ — МЕТКИ СЕРЫЕ (видео для App Review, 06.10).
//
// Журнал сервера: logout 07:10:53.414, через 0,4 с — `GET /cities` БЕЗ токена,
// 200 и пусто; вход 07:11:13 — метки дней перечитаны, сами метки нет. На
// экране имена CALI/CHIC остались (их несёт `day_cities`), цвета и список —
// нет, а «серый» запасной цвет рисовался 64 % почти чёрного. Четыре стены, по
// одной на звено цепочки.

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative: string) => readFileSync(resolve(here, relative), "utf8");

/** Тело функции от объявления до закрывающей скобки в первой колонке. */
function functionBody(source: string, declaration: string): string {
  const from = source.indexOf(declaration);
  assert.notEqual(from, -1, `missing ${declaration}`);
  const to = source.indexOf("\n}\n", from);
  assert.notEqual(to, -1, `unterminated ${declaration}`);
  return source.slice(from, to);
}

describe("выход и вход тем же человеком", () => {
  test("выбор компании погашен, а страницы ещё на экране — заслонка взведена", () => {
    setStorage(new MemoryKVStorage());
    restoreActiveTenantId("user-1");
    setShownSessionUserId("user-1");
    forgetActiveTenantId();
    // Ровно то окно, где календарь перечитывал метки анонимом.
    assert.equal(getSignedInUserId(), "user-1");
    // На экране логин — публичные страницы без входа ходят как раньше.
    setShownSessionUserId(null);
    assert.equal(getSignedInUserId(), null);
  });

  test("дерево сообщает, чьи страницы отрисованы", () => {
    const provider = read("../providers/SessionProvider.tsx");
    assert.match(provider, /setShownSessionUserId\(shownUserId\)/);
    assert.match(provider, /const shownUserId = session\?\.user\?\.id \?\? null;/);
  });

  test("хвост вышедших страниц на входе выбрасывается", () => {
    const source = read("./auth-clear.ts");
    const wipe = functionBody(source, "function wipeFastStores(");
    assert.ok(
      wipe.indexOf("signedOutOnPurpose = true") > wipe.indexOf("queryClient.clear()"),
      "флаг ставит полная чистка кэша",
    );
    const onAuth = functionBody(source, "export async function handleAuthEvent(");
    assert.match(
      onAuth,
      /if \(prev === next\) queryClient\.removeQueries\(\{ type: "inactive" \}\);/,
    );
  });

  test("метки ждут роль, как команды и метки дней", () => {
    const body = functionBody(
      read("../features/reference/queries.ts"),
      "export function useCities(",
    );
    assert.match(body, /enabled: !!tenantId && ready,/);
  });
});

describe("кэш запросов после выхода", () => {
  // Сама механика, на настоящем QueryClient: пустота, прочитанная в окне
  // выхода, без чистки на входе переживает повторный вход, с чисткой — нет.
  const KEY = ["cities", "tenant-1", "live", null];
  const ROWS = [{ name: "CALI" }, { name: "CHIC" }];

  async function poisonedClient(): Promise<QueryClient> {
    const qc = new QueryClient({
      defaultOptions: { queries: { staleTime: 60_000, gcTime: 86_400_000, retry: false } },
    });
    await qc.fetchQuery({ queryKey: KEY, queryFn: async () => ROWS });
    qc.clear();
    // Смонтированный календарь перечитывает в окне выхода — аноним, пусто.
    const gap = new QueryObserver(qc, { queryKey: KEY, queryFn: async () => [] });
    const unsubscribe = gap.subscribe(() => {});
    await gap.refetch();
    unsubscribe(); // дерево ушло на логин
    return qc;
  }

  async function remount(qc: QueryClient): Promise<{ calls: number; data: unknown }> {
    let calls = 0;
    const observer = new QueryObserver(qc, {
      queryKey: KEY,
      queryFn: async () => {
        calls += 1;
        return ROWS;
      },
    });
    const unsubscribe = observer.subscribe(() => {});
    await new Promise((r) => setTimeout(r, 10));
    const data = observer.getCurrentResult().data;
    unsubscribe();
    return { calls, data };
  }

  test("без чистки на входе — свежая пустота, запроса нет (так и было)", async () => {
    const qc = await poisonedClient();
    assert.deepEqual(await remount(qc), { calls: 0, data: [] });
  });

  test("с чисткой на входе — метки читаются заново", async () => {
    const qc = await poisonedClient();
    qc.removeQueries({ type: "inactive" });
    assert.deepEqual(await remount(qc), { calls: 1, data: ROWS });
  });
});

describe("цвет метки, которой нет в справочнике", () => {
  test("запасной цвет — #rrggbb: к нему дописывают альфу суффиксом", () => {
    assert.match(LABEL_FALLBACK_COLOR, /^#[0-9a-f]{6}$/i);
  });

  test("календарь и форма записи не красят метку токеном темы", () => {
    for (const file of [
      "../../app/(dashboard)/(home)/index.tsx",
      "../../app/book/index.tsx",
    ]) {
      const source = read(file);
      const calls = source.split("resolveCalendarDayLabel({").slice(1);
      assert.ok(calls.length > 0, `${file}: нет вызова`);
      for (const call of calls) {
        const fallback = call.match(/fallbackColor: ([^,\n]+),/)?.[1];
        assert.equal(fallback, "LABEL_FALLBACK_COLOR", file);
      }
    }
  });
});
