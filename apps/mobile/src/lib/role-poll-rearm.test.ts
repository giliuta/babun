import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import {
  QueryClient,
  QueryObserver,
  environmentManager,
} from "@tanstack/query-core";

import { rearmRolePollers } from "./role-poll-rearm";
import {
  beginRevalidationPhase,
  endRevalidationPhase,
  markRevalidationRunning,
  resetSwitchRevalidationForTests,
  rolePollInterval,
  subscribeSwitchRevalidation,
} from "./switch-revalidate-plan";

// ОПРОС РОЛИ ОБЯЗАН ЗАМОЛЧАТЬ, КОГДА ОЧЕРЕДЬ ПОШЛА, А НЕ КОГДА ПОВЕЗЁТ.
// Проверка на чистой функции интервала этого не ловила: функция отвечала
// правильно, но react-query её в нужный момент просто не спрашивал. Здесь —
// настоящий наблюдатель с настоящими таймерами.

// Под Node react-query считает себя сервером и таймеры интервала не взводит.
environmentManager.setIsServer(() => false);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterEach(() => {
  resetSwitchRevalidationForTests();
});

describe("опрос роли и тихая очередь", () => {
  test("очередь идёт — ни одного опроса; стихла — опрос вернулся", async () => {
    const client = new QueryClient();
    let fetches = 0;
    const observer = new QueryObserver(client, {
      queryKey: ["current-role", "t-1"],
      queryFn: async () => {
        fetches += 1;
        return "owner";
      },
      staleTime: 30_000,
      refetchInterval: () => rolePollInterval(40),
    });
    const unsubscribe = observer.subscribe(() => {});
    const stopRearm = subscribeSwitchRevalidation(() =>
      rearmRolePollers(client, "current-role"),
    );
    try {
      await sleep(10);
      const generation = beginRevalidationPhase("t-1", []);
      const beforeQueue = fetches;
      markRevalidationRunning(generation);
      await sleep(200);
      assert.equal(fetches - beforeQueue, 0, "опрос роли тикал сквозь тихую очередь");
      endRevalidationPhase(generation);
      const atEnd = fetches;
      await sleep(120);
      assert.ok(fetches - atEnd > 0, "очередь стихла, а опрос роли не проснулся");
    } finally {
      stopRearm();
      unsubscribe();
      client.clear();
    }
  });
});
