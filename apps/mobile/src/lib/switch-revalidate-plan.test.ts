import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ACTIVE_FRESH_MS,
  CLAIM_FIRST_ATTEMPT_DELAY_MS,
  DEFAULT_STALE_MS,
  REVALIDATE_BUDGET_MS,
  SWITCH_REVALIDATE_CONCURRENCY,
  WARM_STALE_MS,
  abandonRevalidationPhase,
  beginRevalidationPhase,
  deferredTenantId,
  endRevalidationPhase,
  isRevalidationIdle,
  isSilentRevalidating,
  markRevalidationRunning,
  planSwitchRevalidation,
  refetchOnMountPolicy,
  resetSwitchRevalidationForTests,
  revalidateUntilSettled,
  rolePollInterval,
  runRevalidationQueue,
  staleTimeFor,
  waitUntilSwitchSettled,
  whenRevalidationIdle,
  type FreshnessContext,
  type RevalidationCandidate,
} from "./switch-revalidate-plan";

// ЧТО ЗДЕСЬ СТОРОЖИТСЯ. Задержка перехода была очередью сервера, а не SQL:
// переход делал протухшим весь кэш, и новая компания уходила в сеть залпом.
// Скорость на глаз снимком не поймать (снимок «вместе» с тапом снимается ДО
// тапа), поэтому проверяются решения: что свежо, что и в каком порядке
// перечитать, сколько разом и когда очередь обязана остановиться.

const here = dirname(fileURLToPath(import.meta.url));
const AIRFIX = "2bc7907e-b149-44a9-92ff-a5e73403031c";
const GILIUTA = "11365a87-bef9-4f6c-a030-b15083fe646b";
const NOW = 1_000_000_000;

beforeEach(() => {
  resetSwitchRevalidationForTests();
});

const justSwitchedToGiliuta: FreshnessContext = {
  activeTenantId: GILIUTA,
  deferredTenantId: GILIUTA,
  knownTenantIds: [AIRFIX, GILIUTA],
};
const settledInGiliuta: FreshnessContext = {
  activeTenantId: GILIUTA,
  deferredTenantId: null,
  knownTenantIds: [AIRFIX, GILIUTA],
};

describe("свежесть по возрасту данных, а не по часам", () => {
  test("компания, куда только что перешли, свежа десять минут — очередь перечитает сама", () => {
    assert.equal(
      staleTimeFor(["appointments", GILIUTA, "master"], justSwitchedToGiliuta),
      WARM_STALE_MS,
    );
  });

  test("компания, где уже работают, свежа минуту", () => {
    assert.equal(
      staleTimeFor(["appointments", GILIUTA, "master"], settledInGiliuta),
      ACTIVE_FRESH_MS,
    );
  });

  test("ключ другой компании человека не уходит в сеть под чужим заголовком", () => {
    assert.equal(
      staleTimeFor(["appointments", AIRFIX, "owner"], settledInGiliuta),
      WARM_STALE_MS,
    );
  });

  test("ключ без компании живёт по прежним 30 с", () => {
    assert.equal(staleTimeFor(["client", "c-1"], settledInGiliuta), DEFAULT_STALE_MS);
  });

  test("refetchOnMount: данных нет — читать", () => {
    assert.equal(
      refetchOnMountPolicy(
        { data: undefined, dataUpdatedAt: 0, isInvalidated: false },
        ["appointments", GILIUTA, "master"],
        justSwitchedToGiliuta,
        NOW,
      ),
      true,
    );
  });

  test("refetchOnMount: ключ компании моложе WARM_STALE_MS — не читать", () => {
    assert.equal(
      refetchOnMountPolicy(
        { data: [], dataUpdatedAt: NOW - 5 * 60_000, isInvalidated: false },
        ["invoices", GILIUTA],
        justSwitchedToGiliuta,
        NOW,
      ),
      false,
    );
  });

  test("refetchOnMount: старше WARM_STALE_MS, явно протухшее или без компании — читать", () => {
    const key = ["invoices", GILIUTA];
    assert.equal(
      refetchOnMountPolicy(
        { data: [], dataUpdatedAt: NOW - 11 * 60_000, isInvalidated: false },
        key,
        justSwitchedToGiliuta,
        NOW,
      ),
      true,
    );
    // Своя же правка пометила протухшим — возврат на экран обязан её увидеть.
    assert.equal(
      refetchOnMountPolicy(
        { data: [], dataUpdatedAt: NOW - 1_000, isInvalidated: true },
        key,
        justSwitchedToGiliuta,
        NOW,
      ),
      true,
    );
    assert.equal(
      refetchOnMountPolicy(
        { data: [], dataUpdatedAt: NOW - 1_000, isInvalidated: false },
        ["client", "c-1"],
        justSwitchedToGiliuta,
        NOW,
      ),
      true,
    );
    // Устоявшаяся компания — решает `staleTime` самого запроса, как раньше.
    assert.equal(
      refetchOnMountPolicy(
        { data: [], dataUpdatedAt: NOW - 1_000, isInvalidated: false },
        key,
        settledInGiliuta,
        NOW,
      ),
      true,
    );
  });
});

function candidate(
  queryKey: readonly unknown[],
  patch: Partial<RevalidationCandidate> = {},
): RevalidationCandidate {
  return {
    queryKey,
    queryHash: JSON.stringify(queryKey),
    hasData: true,
    dataUpdatedAt: NOW - 5 * 60_000,
    isInvalidated: false,
    active: true,
    fetching: false,
    ...patch,
  };
}

describe("план тихой очереди", () => {
  const cache: RevalidationCandidate[] = [
    candidate(["services", GILIUTA, "master"]),
    candidate(["appointments", AIRFIX, "owner"]),
    candidate(["teams", GILIUTA, "master"]),
    candidate(["clients", GILIUTA, "master"], { dataUpdatedAt: NOW - 30_000 }),
    candidate(["tenant", GILIUTA, "master"]),
    candidate(["appointments", GILIUTA, "master"]),
    candidate(["calendar-settings", GILIUTA, "master"]),
    candidate(["masters", GILIUTA, "master"], { active: false }),
    candidate(["day-cities", GILIUTA, "master"], { hasData: false }),
    candidate(["cities", GILIUTA, "live", null], { fetching: true }),
    candidate(["day-extras", GILIUTA, "master"], {
      dataUpdatedAt: NOW - 1_000,
      isInvalidated: true,
    }),
    candidate(["client", "c-1"]),
  ];

  test("только новая компания, только то, что рисуют, в порядке важности", () => {
    const plan = planSwitchRevalidation(cache, GILIUTA, NOW);
    assert.deepEqual(
      plan.map((c) => c.queryKey[0]),
      [
        "appointments",
        "teams",
        "calendar-settings",
        "tenant",
        "services",
        "day-extras",
      ],
    );
    assert.ok(
      plan.every((c) => c.queryKey.includes(GILIUTA)),
      "ключ покидаемой компании ушёл бы с новым заголовком — гонка потери данных",
    );
  });

  test("уже перечитанное повторный проход не берёт", () => {
    const skip = new Set([JSON.stringify(["appointments", GILIUTA, "master"])]);
    const plan = planSwitchRevalidation(cache, GILIUTA, NOW, skip);
    assert.equal(plan[0]?.queryKey[0], "teams");
  });

  // РОЛЬ ИЗ ЛЕНТЫ. Переход кладёт роль из ленты компаний прямо перед сменой, и
  // её дата — минута перехода. Опрос роли всю очередь стоит, так что очередь —
  // единственная сверка «всё ещё участник»: ответ `null` выселяет компанию.
  test("роль, положенная из ленты «только что», перечитывается первой", () => {
    const plan = planSwitchRevalidation(
      [
        candidate(["appointments", GILIUTA, "master"]),
        candidate(["current-role", GILIUTA], { dataUpdatedAt: NOW }),
      ],
      GILIUTA,
      NOW,
    );
    assert.deepEqual(
      plan.map((c) => c.queryKey[0]),
      ["current-role", "appointments"],
      "свежая на вид роль не сверена — снятый участник смотрит кэш всю очередь",
    );
  });

  test("роль другой компании очередь не берёт, даже «свежую»", () => {
    const plan = planSwitchRevalidation(
      [candidate(["current-role", AIRFIX], { dataUpdatedAt: NOW })],
      GILIUTA,
      NOW,
    );
    assert.deepEqual(plan, []);
  });

  test("перечитанная роль второй раз за фазу не планируется", () => {
    const role = candidate(["current-role", GILIUTA], { dataUpdatedAt: NOW });
    const plan = planSwitchRevalidation([role], GILIUTA, NOW, new Set([role.queryHash]));
    assert.deepEqual(plan, []);
  });
});

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 1));

describe("очередь", () => {
  test("не больше двух чтений разом, в порядке плана", async () => {
    assert.equal(SWITCH_REVALIDATE_CONCURRENCY, 2);
    let inFlight = 0;
    let peak = 0;
    const started: number[] = [];
    await runRevalidationQueue({
      jobs: [1, 2, 3, 4, 5],
      concurrency: SWITCH_REVALIDATE_CONCURRENCY,
      shouldContinue: () => true,
      run: async (job) => {
        started.push(job);
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await tick();
        inFlight -= 1;
      },
    });
    assert.equal(peak, 2);
    assert.deepEqual(started, [1, 2, 3, 4, 5]);
  });

  test("компания сменилась — оставшиеся чтения не начинаются", async () => {
    let active = GILIUTA;
    const started: number[] = [];
    const count = await runRevalidationQueue({
      jobs: [1, 2, 3, 4],
      concurrency: 2,
      shouldContinue: () => active === GILIUTA,
      run: async (job) => {
        started.push(job);
        if (job === 2) active = AIRFIX;
        await tick();
      },
    });
    assert.deepEqual(started, [1, 2]);
    assert.equal(count, 2);
  });

  test("упавшее чтение очередь не останавливает", async () => {
    const started: number[] = [];
    await runRevalidationQueue({
      jobs: [1, 2, 3],
      concurrency: 1,
      shouldContinue: () => true,
      run: async (job) => {
        started.push(job);
        if (job === 1) throw new Error("сеть");
      },
    });
    assert.deepEqual(started, [1, 2, 3]);
  });
});

// ПРОХОДЫ — ДО ПУСТОГО ПЛАНА. Потолок в три прохода оставлял без чтения экран,
// открытый во время последнего: под длинным порогом фазы монтирование в сеть
// не идёт, а фаза закрывалась, так его и не перечитав.
describe("проходы очереди — до пустого плана, а не до числа проходов", () => {
  test("экран, открытый во время каждого прохода, перечитан; конец — только на пустом плане", async () => {
    let clock = 0;
    const done = new Set<string>();
    const mounted = ["экран-1"];
    const ran: string[] = [];
    const plans: number[] = [];
    await revalidateUntilSettled({
      plan: () => {
        const jobs = mounted.filter((key) => !done.has(key));
        plans.push(jobs.length);
        return jobs;
      },
      runQueue: async (jobs) => {
        for (const job of jobs) {
          done.add(job);
          ran.push(job);
        }
        clock += 1_000;
        // Во время проходов 1–4 открывается ещё один экран.
        if (mounted.length < 5) mounted.push(`экран-${mounted.length + 1}`);
      },
      fireAndForget: () => assert.fail("бюджет не вышел — отпускать без ожидания нечего"),
      shouldContinue: () => true,
      now: () => clock,
      budgetMs: REVALIDATE_BUDGET_MS,
    });
    assert.deepEqual(ran, ["экран-1", "экран-2", "экран-3", "экран-4", "экран-5"]);
    assert.equal(plans.at(-1), 0, "очередь закрылась не на пустом плане");
  });

  test("бюджет вышел — последний план уходит без ожидания, и очередь закрывается", async () => {
    let clock = 0;
    let screen = 0;
    const queued: string[][] = [];
    const released: string[] = [];
    await revalidateUntilSettled({
      // Экраны открываются без конца — выйти обязан бюджет.
      plan: () => [`экран-${++screen}`],
      runQueue: async (jobs) => {
        queued.push(jobs);
        clock += 20_000;
      },
      fireAndForget: (job) => released.push(job),
      shouldContinue: () => true,
      now: () => clock,
      budgetMs: 45_000,
    });
    assert.deepEqual(queued, [["экран-1"], ["экран-2"], ["экран-3"]]);
    assert.deepEqual(released, ["экран-4"]);
  });

  test("компания сменилась — ни плана, ни чтений", async () => {
    let planned = 0;
    await revalidateUntilSettled({
      plan: () => {
        planned += 1;
        return ["экран-1"];
      },
      runQueue: async () => assert.fail("чтение после смены компании"),
      fireAndForget: () => assert.fail("чтение после смены компании"),
      shouldContinue: () => false,
      now: () => 0,
      budgetMs: REVALIDATE_BUDGET_MS,
    });
    assert.equal(planned, 0);
  });
});

describe("фаза дообновления", () => {
  test("запланирована → идёт → стихла", () => {
    const generation = beginRevalidationPhase(GILIUTA, [AIRFIX]);
    assert.equal(deferredTenantId(), GILIUTA);
    assert.equal(isSilentRevalidating(), false, "до старта полосу не прячем");
    assert.equal(markRevalidationRunning(generation), true);
    assert.equal(isSilentRevalidating(), true);
    endRevalidationPhase(generation);
    assert.equal(isRevalidationIdle(), true);
    assert.equal(deferredTenantId(), null);
  });

  test("круг A → B → A: позднее окончание очереди B не гасит фазу A", () => {
    const toGiliuta = beginRevalidationPhase(GILIUTA, [AIRFIX]);
    beginRevalidationPhase(AIRFIX, [GILIUTA]);
    endRevalidationPhase(toGiliuta);
    assert.equal(markRevalidationRunning(toGiliuta), false);
    assert.equal(deferredTenantId(), AIRFIX);
  });

  test("сорвавшийся переход снимает только свою фазу", () => {
    beginRevalidationPhase(AIRFIX, []);
    abandonRevalidationPhase(GILIUTA);
    assert.equal(deferredTenantId(), AIRFIX);
    abandonRevalidationPhase(AIRFIX);
    assert.equal(isRevalidationIdle(), true);
  });

  test("ожидание тишины отпускает только после окончания", async () => {
    const generation = beginRevalidationPhase(GILIUTA, []);
    let settled = false;
    const waiting = whenRevalidationIdle().then(() => {
      settled = true;
    });
    await tick();
    assert.equal(settled, false);
    endRevalidationPhase(generation);
    await waiting;
    assert.equal(settled, true);
  });
});

describe("фоновые работы ждут тишины", () => {
  test("догон claim'а: не раньше 3 с и не раньше конца очереди", async () => {
    assert.equal(CLAIM_FIRST_ATTEMPT_DELAY_MS, 3_000);
    let now = 0;
    const sleeps: number[] = [];
    const events: string[] = [];
    const generation = beginRevalidationPhase(GILIUTA, []);
    markRevalidationRunning(generation);
    setTimeout(() => {
      events.push("очередь стихла");
      endRevalidationPhase(generation);
    }, 5);
    await waitUntilSwitchSettled(
      () => CLAIM_FIRST_ATTEMPT_DELAY_MS,
      () => now,
      async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
    );
    events.push("догон");
    assert.deepEqual(sleeps, [3_000]);
    assert.deepEqual(events, ["очередь стихла", "догон"]);
  });

  test("без перехода ждать нечего", async () => {
    const sleeps: number[] = [];
    await waitUntilSwitchSettled(
      () => 0,
      () => 10,
      async (ms) => {
        sleeps.push(ms);
      },
    );
    assert.deepEqual(sleeps, []);
  });

  test("опрос роли стоит, пока очередь читает сеть", () => {
    assert.equal(rolePollInterval(60_000), 60_000);
    const generation = beginRevalidationPhase(GILIUTA, []);
    markRevalidationRunning(generation);
    assert.equal(rolePollInterval(60_000), false);
    endRevalidationPhase(generation);
    assert.equal(rolePollInterval(60_000), 60_000);
  });
});

describe("проводка в коде", () => {
  test("порог тёплого совпадает с прогревом", () => {
    const prefetch = readFileSync(resolve(here, "tenant-prefetch.ts"), "utf8");
    const declared = /const WARM_STALE_MS = 10 \* 60_000;/.test(prefetch);
    const imported = /WARM_STALE_MS[\s\S]*from "@\/lib\/switch-revalidate-plan"/.test(
      prefetch,
    );
    assert.ok(declared || imported, "прогрев и переход разошлись в пороге тёплого");
    assert.equal(WARM_STALE_MS, 10 * 60_000);
  });

  test("query-client решает свежесть этими правилами", () => {
    const source = readFileSync(resolve(here, "query-client.ts"), "utf8");
    assert.match(source, /staleTime: \(query\) => staleTimeFor\(query\.queryKey, freshnessContext\(\)\)/);
    assert.match(source, /refetchOnMount: \(query\) =>\s*refetchOnMountPolicy\(/);
  });

  test("догон claim'а ждёт тишины перед каждой попыткой, а переход ставит 3 с", () => {
    const source = readFileSync(resolve(here, "claim-catch-up.ts"), "utf8");
    const wait = source.indexOf("await waitUntilSwitchSettled(() => firstAttemptNotBefore)");
    const attempt = source.indexOf("await tryCatchUp(userId, live)");
    assert.notEqual(wait, -1);
    assert.ok(wait < attempt, "попытка догона ушла раньше ожидания тишины");
    assert.match(
      source,
      /firstAttemptNotBefore = Date\.now\(\) \+ CLAIM_FIRST_ATTEMPT_DELAY_MS;\s*rememberPendingClaim\(userId, tenantId\);/,
    );
  });

  test("опрос роли спрашивает паузу у очереди и перевзводится на КАЖДОЙ смене фазы", () => {
    const source = readFileSync(
      resolve(here, "../features/settings/tenant.ts"),
      "utf8",
    );
    assert.match(source, /refetchInterval: \(\) => rolePollInterval\(ROLE_POLL_MS\)/);
    assert.match(
      source,
      /subscribeSwitchRevalidation\(\(\) =>\s*rearmRolePollers\(queryClient, currentRoleQueryKey\(null\)\[0\]\),?\s*\);/,
    );
    assert.doesNotMatch(
      source,
      /isSilentRevalidating/,
      "ранний выход по «очередь идёт» не гасил опрос на старте очереди",
    );
  });

  test("очередь перехода планирует до пустого плана и отмечает сделанным только перечитанное", () => {
    const source = readFileSync(resolve(here, "switch-revalidate.ts"), "utf8");
    assert.doesNotMatch(source, /MAX_PASSES/);
    assert.match(source, /await revalidateUntilSettled\(\{/);
    assert.match(
      source,
      /if \(!query\?\.isActive\(\)\) return Promise\.resolve\(\);\s*done\.add\(job\.queryHash\);/,
    );
  });
});
