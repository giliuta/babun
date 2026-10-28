import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { removeUnobservedQueries } from "./sign-out-query-sweep";

// ПОСЛЕ «ВЫЙТИ» ЗАПРОСЫ НЕ УХОДЯТ АНОНИМОМ.
//
// Журнал шлюза: logout, через 0,4 с семь 401 разом — все запросы, висящие над
// экраном входа (реестр прав, лента календарей, скрытые и порядок, роль,
// уведомления). Не повторы, а новые запросы: чистка на выходе сносила кэш под
// живыми страницами, перерисовка заводила их заново, и к fetch они приходили
// уже после смены дерева на логин — когда заслонка открыта.
//
// Здесь — настоящий `QueryObserver`, а не копия логики: «перерисовка» — это
// `setOptions`, ровно то, что `useQuery` делает в эффекте каждой отрисовки.

const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string): string => readFileSync(resolve(here, path), "utf8");

const KEY = ["access-blocks"];

function mountedScreen(qc: QueryClient) {
  const calls = { n: 0 };
  const options = (enabled: boolean) => ({
    queryKey: KEY,
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      calls.n += 1;
      return "реестр";
    },
  });
  qc.setQueryData(KEY, "реестр");
  const observer = new QueryObserver(qc, options(true));
  const unsubscribe = observer.subscribe(() => {});
  return {
    calls,
    rerender: (enabled = true) => observer.setOptions(options(enabled)),
    unsubscribe,
  };
}

describe("выход: кэш под живыми страницами", () => {
  test("ПРИЧИНА: снос под живым экраном — перерисовка снова идёт в сеть", () => {
    const qc = new QueryClient();
    const screen = mountedScreen(qc);
    assert.equal(screen.calls.n, 0, "свежие данные на монтировании не перечитываются");
    qc.clear();
    screen.rerender();
    assert.equal(screen.calls.n, 1, "если здесь 0 — сторож ослеп: причина больше не воспроизводится");
    screen.unsubscribe();
  });

  test("«Выйти» сносит только ненаблюдаемое — перерисовка в сеть не идёт", () => {
    const qc = new QueryClient();
    const screen = mountedScreen(qc);
    qc.setQueryData(["client", "c-1"], { name: "Клиент вышедшего" });
    removeUnobservedQueries(qc);
    assert.equal(qc.getQueryData(["client", "c-1"]), undefined, "хвост без экранов уходит сразу");
    screen.rerender();
    assert.equal(screen.calls.n, 0);
    screen.unsubscribe();
  });

  test("на экране логин запрос выключен — снос остатка в сеть не ведёт", () => {
    const qc = new QueryClient();
    const screen = mountedScreen(qc);
    removeUnobservedQueries(qc);
    screen.rerender(false); // сессии нет: `enabled: !!userId`
    qc.clear(); // clearQueriesLeftBySignOut
    screen.rerender(false);
    assert.equal(screen.calls.n, 0);
    assert.equal(qc.getQueryData(KEY), undefined, "данных вышедшего в кэше не осталось");
    screen.unsubscribe();
  });

  test("проводка: «Выйти» откладывает снос, логин его доделывает", () => {
    const signOut = read("./auth-clear.ts");
    assert.match(signOut, /await wipeTenantScopedData\(\{ afterSignOut: true \}\);/);
    const wipe = read("./auth-clear/wipe.ts");
    assert.match(wipe, /if \(afterSignOut\) \{\s+removeUnobservedQueries\(queryClient\);/);
    const provider = read("../providers/SessionProvider.tsx");
    assert.match(
      provider,
      /if \(signedOutNow\(shownBefore\.current, shownUserId\)\) \{[^}]*clearQueriesLeftBySignOut\(\);/,
    );
    // Если дерево логин так и не показало — доделывает вход.
    assert.match(signOut, /clearQueriesLeftBySignOut\(\);\n\s+if \(consumeSignedOutOnPurpose\(\)\)/);
  });
});

describe("один клиент supabase на процесс", () => {
  test("в dev клиент переживает перезапуск модуля, слушатель AppState — один", () => {
    const source = read("./supabase.ts");
    assert.match(source, /__babunSupabase \?\?= \{\}/);
    assert.match(source, /export const supabase = reused \?\? createBabunClient\(\);/);
    assert.match(source, /if \(Platform\.OS !== "web" && !reused\) \{/);
    // Перезапущенный модуль подставляет свежую обёртку fetch по ссылке.
    assert.match(source, /if \(devSlot\) devSlot\.fetch = fetchWithActiveTenant;/);
    assert.equal(source.match(/createClient</g)?.length, 1, "клиент заводится в одном месте");
  });
});
