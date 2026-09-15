import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import * as keyBuilders from "./company-query-keys";
import {
  ACTIVE_COMPANY_SKIPS,
  companiesToWarm,
  planCalendarWave,
  planCompanyCalendar,
  planCompanyFinances,
  planCompanyGate,
  planFinanceWave,
  runWarmQueue,
  screensBusyFrom,
  type WarmCompany,
  type WarmKind,
  type WarmQueueOptions,
  type WarmTarget,
} from "./tenant-prefetch-plan";
import { keyNamesKnownTenant, querySurvivesSwitch } from "./tenant-query-keys";

const T = "11365a87-bef9-4f6c-a030-b15083fe646b";
const OTHER = "2bc7907e-b149-44a9-92ff-a5e73403031c";
const PERIOD = { from: "2026-09-01", to: "2026-09-30" };
const ROLES = ["owner", "dispatcher", "master"] as const;

const keysOf = (targets: { queryKey: readonly unknown[] }[]) =>
  targets.map((t) => JSON.stringify(t.queryKey));

const everyTarget = (tenantId: string, role: (typeof ROLES)[number]): WarmTarget[] => [
  ...planCompanyGate({ tenantId, role }),
  ...planCompanyCalendar({ tenantId, role }),
  ...planCompanyFinances({ tenantId, period: PERIOD }),
];

describe("план прогрева компании", () => {
  test("гейт — профиль, настройки и ОДИН список команд (с архивом)", () => {
    assert.deepEqual(keysOf(planCompanyGate({ tenantId: T, role: "master" })), [
      JSON.stringify(["tenant", T, "master"]),
      JSON.stringify(["calendar-settings", T, "master"]),
      JSON.stringify(["teams", T, "master", "all"]),
    ]);
  });

  test("владелец: календарь → клиенты → кабинет, потом деньги", () => {
    assert.deepEqual(
      keysOf(planCompanyCalendar({ tenantId: T, role: "owner" })),
      [
        ["appointments", T, "owner"],
        ["services", "with-archived", T, "owner"],
        ["cities", T, "live", null],
        ["day-cities", T, "owner"],
        ["team-schedules", T, "owner", "all"],
        ["day-extras", T, "owner"],
        ["clients", T, "owner"],
        ["client-tags", T, "owner"],
        ["masters", T, "owner"],
        ["masters", T, "owner", "all"],
      ].map((k) => JSON.stringify(k)),
    );
    assert.deepEqual(
      keysOf(planCompanyFinances({ tenantId: T, period: PERIOD })),
      [
        ["finance-categories", T],
        ["transactions", T, "2026-09-01", "2026-09-30", null, null],
        ["transactions", T, "refund-totals"],
        ["invoices", T],
        ["invoices", T, "payments"],
        ["accounts", T, "rows", "active"],
        ["accounts", T, "balances"],
      ].map((k) => JSON.stringify(k)),
    );
  });

  test("ни одного ключа по команде: метки и графики — карта компании", () => {
    for (const role of ROLES) {
      for (const t of everyTarget(T, role)) {
        if (t.queryKey[0] === "cities") assert.equal(t.queryKey[3], null);
        if (t.queryKey[0] === "team-schedules") assert.equal(t.queryKey[3], "all");
        if (t.queryKey[0] === "teams") assert.equal(t.queryKey[3], "all");
      }
    }
  });

  test("мастер: карта графиков есть, ручных операций нет, ключи его роли", () => {
    const plan = planCompanyCalendar({ tenantId: T, role: "master" });
    const kinds = plan.map((t) => t.kind);
    assert.ok(kinds.includes("appointments"));
    assert.ok(kinds.includes("team-schedules-all"));
    assert.ok(!kinds.includes("day-extras"));
    for (const t of [...planCompanyGate({ tenantId: T, role: "master" }), ...plan]) {
      // Ключ роли — «master», а не «owner» и не «role-pending»: экран мастера
      // спросит ровно его, и «role-pending» он не спросит никогда.
      assert.ok(!t.queryKey.includes("owner"), JSON.stringify(t.queryKey));
      assert.ok(!t.queryKey.includes("role-pending"), JSON.stringify(t.queryKey));
    }
  });

  test("каждый ключ называет СВОЮ компанию — и потому переживает переход", () => {
    for (const t of everyTarget(T, "owner")) {
      assert.ok(keyNamesKnownTenant(t.queryKey, [T]), JSON.stringify(t.queryKey));
      assert.ok(querySurvivesSwitch(t.queryKey, [T, OTHER]));
      // И не называет чужую: иначе чистка при уходе из OTHER берегла бы его
      // по ошибке, а прогретые данные одной компании легли бы под ключ другой.
      assert.ok(!keyNamesKnownTenant(t.queryKey, [OTHER]));
    }
  });

  test("срез журнала несёт свои границы, чтобы исполнитель читал тот же месяц", () => {
    const [tx] = planCompanyFinances({ tenantId: T, period: PERIOD }).filter(
      (t) => t.kind === "transactions",
    );
    assert.equal(tx?.from, PERIOD.from);
    assert.equal(tx?.to, PERIOD.to);
  });
});

describe("какие компании и в каком порядке", () => {
  test("активная первой, даже если в ленте она последняя; компания — один раз", () => {
    const companies = companiesToWarm({
      calendars: [
        { tenantId: OTHER, role: "master" },
        { tenantId: OTHER, role: "master" },
        { tenantId: T, role: "owner" },
      ],
      activeTenantId: T,
      activeRole: "owner",
    });
    assert.deepEqual(companies, [
      { tenantId: T, role: "owner", active: true },
      { tenantId: OTHER, role: "master", active: false },
    ]);
  });

  test("роль активной — из опроса роли, а не из ленты", () => {
    const [active] = companiesToWarm({
      calendars: [{ tenantId: T, role: "owner" }],
      activeTenantId: T,
      activeRole: "dispatcher",
    });
    assert.deepEqual(active, { tenantId: T, role: "dispatcher", active: true });
  });

  test("роль активной неизвестна — активную не греем, другие греем", () => {
    const companies = companiesToWarm({
      calendars: [
        { tenantId: T, role: "owner" },
        { tenantId: OTHER, role: "master" },
      ],
      activeTenantId: T,
      activeRole: null,
    });
    assert.deepEqual(companies, [{ tenantId: OTHER, role: "master", active: false }]);
  });

  const A: WarmCompany = { tenantId: T, role: "owner", active: true };
  const B: WarmCompany = { tenantId: OTHER, role: "owner", active: false };

  test("в ширину: календарь каждой компании раньше денег любой", () => {
    const calendar = planCalendarWave([A, B]);
    const finances = planFinanceWave([
      { ...A, canViewFinances: true, period: PERIOD },
      { ...B, canViewFinances: true, period: PERIOD },
    ]);
    const financeKinds = new Set(planCompanyFinances({ tenantId: T, period: PERIOD }).map((t) => t.kind));
    assert.ok(calendar.every((job) => !financeKinds.has(job.target.kind)));
    assert.ok(finances.every((job) => financeKinds.has(job.target.kind)));
    // Внутри волны — активная, потом другая, без перемешивания.
    const tenants = calendar.map((job) => job.tenantId);
    assert.equal(tenants.indexOf(OTHER), tenants.lastIndexOf(T) + 1);
    assert.deepEqual(
      finances.map((job) => job.tenantId),
      [...Array(7).fill(T), ...Array(7).fill(OTHER)],
    );
  });

  test("у активной компании нет ключей хуков с побочными действиями, у другой — есть", () => {
    const activeKinds = planCalendarWave([A]).map((job) => job.target.kind);
    const otherKinds = planCalendarWave([B]).map((job) => job.target.kind);
    for (const kind of ACTIVE_COMPANY_SKIPS) {
      assert.ok(!activeKinds.includes(kind), kind);
      assert.ok(otherKinds.includes(kind), kind);
    }
    assert.ok(activeKinds.includes("team-schedules-all"));
    assert.ok(activeKinds.includes("masters-all"));
  });

  test("деньги — только где роль их видит и период известен", () => {
    const jobs = planFinanceWave([
      { ...A, canViewFinances: false, period: PERIOD },
      { ...B, canViewFinances: true, period: null },
    ]);
    assert.deepEqual(jobs, []);
  });
});

// ─── КОНТРАКТ: КЛЮЧ ПРОГРЕВА = КЛЮЧ ХУКА ─────────────────────────────
//
// Хуки тянут react-native и supabase и под раннером не поднимаются. Поэтому
// ключ хука выводится из ИСХОДНИКА: в теле хука находится `queryKey: <фабрика>(
// аргументы)`, фабрика берётся та же из `company-query-keys.ts`, аргументы
// подставляются (компания, роль, литералы; переменные — всеми значениями,
// которые хук может передать), и план обязан совпасть с одним из вариантов.
// Хук сменил фабрику или аргумент — тест падает, и прогрев не станет молча
// греть мимо экрана.

const here = __dirname;

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

const sourceOf = (rel: string) => stripComments(readFileSync(join(here, rel), "utf8"));

interface HookContract {
  file: string;
  hooks: string[];
  builder: keyof typeof keyBuilders;
  /** Значения аргумента ключа для ЭТОГО хука вместо общей таблицы. Пустой
   *  список — аргументу в ключе быть нельзя вовсе. */
  argValues?: Record<string, unknown[]>;
}

const CALENDAR = "../features/calendar/queries.ts";
const REFERENCE = "../features/reference/queries.ts";
const SERVICES = "../features/services/queries.ts";
const CLIENTS = "../features/clients/queries.ts";
const FINANCES = "../features/finances/queries.ts";
const ACCOUNTS = "../features/finances/accounts.ts";
const INVOICES = "../features/invoices/queries.ts";

const HOOKS: Record<WarmKind, HookContract> = {
  tenant: { file: "../features/settings/tenant.ts", hooks: ["useTenant"], builder: "tenantQueryKey" },
  "calendar-settings": {
    file: "../features/settings/local-settings.ts",
    hooks: ["useCalendarSettings"],
    builder: "calendarSettingsQueryKey",
  },
  // Вариант «с архивом / без» в ключ `useTeams` попадать не должен: ключ один
  // на оба вызова, иначе вернутся два запроса за одной таблицей.
  "teams-all": {
    file: REFERENCE,
    hooks: ["useTeams"],
    builder: "teamsQueryKey",
    argValues: { includeInactive: [] },
  },
  appointments: { file: CALENDAR, hooks: ["useAppointments"], builder: "appointmentsQueryKey" },
  // Каталог выбора и полный справочник — один ключ, как у команд.
  "services-all": {
    file: SERVICES,
    hooks: ["useServices", "useAllServices"],
    builder: "allServicesQueryKey",
  },
  cities: { file: REFERENCE, hooks: ["useCities"], builder: "citiesQueryKey" },
  "day-cities": { file: "../features/calendar/day-cities.ts", hooks: ["useDayCities"], builder: "dayCitiesQueryKey" },
  "team-schedules-all": {
    file: "../features/reference/team-schedule.ts",
    hooks: ["useTeamSchedule", "useAllTeamSchedules"],
    builder: "allTeamSchedulesQueryKey",
  },
  "day-extras": { file: CALENDAR, hooks: ["useDayExtras"], builder: "dayExtrasQueryKey" },
  clients: { file: CLIENTS, hooks: ["useClients"], builder: "clientsQueryKey" },
  "client-tags": { file: CLIENTS, hooks: ["useClientTags"], builder: "clientTagsQueryKey" },
  masters: { file: REFERENCE, hooks: ["useMasters"], builder: "mastersQueryKey" },
  "masters-all": { file: REFERENCE, hooks: ["useMasters"], builder: "mastersQueryKey" },
  "finance-categories": { file: FINANCES, hooks: ["useFinanceCategories"], builder: "financeCategoriesQueryKey" },
  transactions: { file: FINANCES, hooks: ["useTransactions"], builder: "ledgerRangeQueryKey" },
  "refund-totals": { file: FINANCES, hooks: ["useRefundTotals"], builder: "refundTotalsQueryKey" },
  invoices: { file: INVOICES, hooks: ["useInvoices"], builder: "invoicesQueryKey" },
  "invoice-payments": { file: INVOICES, hooks: ["useInvoicePayments"], builder: "invoicePaymentsQueryKey" },
  "account-rows": { file: ACCOUNTS, hooks: ["useAccountsWithBalances"], builder: "accountRowsQueryKey" },
  "account-balances": { file: ACCOUNTS, hooks: ["useAccountsWithBalances"], builder: "accountBalancesQueryKey" },
};

/** Фабрики по имени — простым объектом: индексировать сам импорт-пространство
 *  линтер не даёт проверить. */
const BUILDERS: Record<string, unknown> = { ...keyBuilders };

/** Фабрика, объявленная в файле хука, а не взятая из общего листа. Допустима,
 *  только если её тело — буквально тот же ключ. */
const LOCAL_BUILDERS: Record<string, string> = {
  dayCitiesQueryKey: 'return ["day-cities", tenantId, role ?? "role-pending"] as const;',
};

const ANY = Symbol("любое значение");

/** Значения, которые хук может передать фабрике на месте аргумента. */
function argValues(token: string, role: string): unknown[] {
  switch (token) {
    case "tenantId":
      return [T];
    case "role":
    case "roleQuery.data":
      return [role];
    case "true":
      return [true];
    case "false":
      return [false];
    case "null":
      return [null];
    case "includeInactive":
      return [true, false];
    case "from":
    case "to":
    case "teamScope":
    case "accountScope":
      return [ANY];
    default:
      return assert.fail(`неизвестный аргумент ключа «${token}» — дополни таблицу теста`);
  }
}

function hookBody(source: string, hook: string, file: string): string {
  const start = source.search(new RegExp(`export (?:async )?function ${hook}\\(`));
  assert.ok(start >= 0, `в ${file} нет хука ${hook}`);
  const rest = source.slice(start + 1);
  const end = rest.search(/\nexport /);
  return end < 0 ? rest : rest.slice(0, end);
}

/** Имя, под которым фабрика видна в файле хука (импорт может быть с `as`). */
function localBuilderName(source: string, builder: string, file: string): string {
  const imports = [...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*"@\/lib\/company-query-keys"/g)]
    .flatMap((m) => (m[1] as string).split(","))
    .map((part) => part.trim())
    .filter(Boolean);
  for (const part of imports) {
    const [name, alias] = part.split(/\s+as\s+/);
    if (name === builder) return alias ?? name;
  }
  const local = LOCAL_BUILDERS[builder];
  assert.ok(local, `${file} не берёт ${builder} из company-query-keys`);
  const decl = source.search(new RegExp(`export function ${builder}\\(`));
  assert.ok(decl >= 0, `в ${file} нет ни импорта, ни объявления ${builder}`);
  assert.ok(
    source.slice(decl).replace(/\s+/g, " ").includes(local.replace(/\s+/g, " ")),
    `${builder} в ${file} строит не тот ключ`,
  );
  return builder;
}

function combos(lists: unknown[][]): unknown[][] {
  return lists.reduce<unknown[][]>(
    (acc, values) => acc.flatMap((prefix) => values.map((v) => [...prefix, v])),
    [[]],
  );
}

function matches(expected: unknown, actual: unknown): boolean {
  if (expected === ANY) return true;
  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      expected.length === actual.length &&
      expected.every((e, i) => matches(e, actual[i]))
    );
  }
  return Object.is(expected, actual);
}

/** Все ключи, которые хук строит этой фабрикой при данной роли. */
function keysHookBuilds(contract: HookContract, hook: string, role: string): unknown[][] {
  const source = sourceOf(contract.file);
  const name = localBuilderName(source, contract.builder, contract.file);
  const body = hookBody(source, hook, contract.file);
  const segments = [
    ...body.matchAll(
      /queryKey:([\s\S]*?)\n\s*(?:enabled|queryFn|select|staleTime|placeholderData|networkMode|initialData|gcTime|retry|meta)\s*:/g,
    ),
  ].map((m) => m[1] as string);
  const call = segments
    .map((segment) => segment.match(new RegExp(`\\b${name}\\(([^()]*)\\)`)))
    .find(Boolean);
  assert.ok(call, `${hook} (${contract.file}) не строит ключ через ${name}`);
  const args = (call[1] as string)
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
  const build = BUILDERS[contract.builder] as (...a: unknown[]) => readonly unknown[];
  return combos(
    args.map((token) => contract.argValues?.[token] ?? argValues(token, role)),
  ).map((values) => [...build(...values)]);
}

describe("контракт: каждый ключ прогрева — тот, что строит хук экрана", () => {
  for (const role of ROLES) {
    test(`роль ${role}`, () => {
      for (const target of everyTarget(T, role)) {
        const contract = HOOKS[target.kind];
        assert.ok(contract, `у цели «${target.kind}» нет строки контракта`);
        for (const hook of contract.hooks) {
          const candidates = keysHookBuilds(contract, hook, role);
          assert.ok(
            candidates.some((key) => matches(key, target.queryKey)),
            `${target.kind}: прогрев греет ${JSON.stringify(target.queryKey)}, а ${hook} строит ${candidates
              .map((k) => JSON.stringify(k))
              .join(" | ")}`,
          );
        }
      }
    });
  }

  test("команды: один ключ с архивом на оба вызова, активные — только select", () => {
    // Хук зовут и с архивом, и без: вариант не должен попадать ни в ключ, ни в
    // чтение, иначе вернутся два запроса за одной таблицей, а под общим ключом
    // «all» ляжет список без архива. Отсев архивных — только на устройстве.
    const body = hookBody(sourceOf(REFERENCE), "useTeams", REFERENCE);
    assert.match(body, /queryKey:\s*teamsQueryKey\(\s*tenantId\s*,\s*role\s*,\s*true\s*\)/);
    assert.match(body, /fetchTeams\([^)]*,\s*true\s*\)/);
    assert.match(body, /select:\s*includeInactive\s*\?\s*undefined\s*:\s*pickLiveTeams\b/);
  });

  test("активной компании не греем ключ, чей хук делает больше, чем читает", () => {
    const MARKS = ["Cached(", "setDefaultCurrency", "safeSave", "emitRevalidated", "cacheReplaceTenant", "getStorage("];
    const functionBody = (source: string, name: string): string | null => {
      const start = source.search(new RegExp(`(?:^|\\n)(?:export )?(?:async )?function ${name}\\(`));
      if (start < 0) return null;
      const rest = source.slice(start + 1);
      const end = rest.search(/\n(?:export )?(?:async )?function /);
      return end < 0 ? rest : rest.slice(0, end);
    };
    for (const [kind, contract] of Object.entries(HOOKS) as [WarmKind, HookContract][]) {
      const source = sourceOf(contract.file);
      for (const hook of contract.hooks) {
        // Хук и функции своего файла, которые он зовёт (на две ступени):
        // `useAppointments` читает через `listAppointmentsPaged`, а та — через
        // офлайн-обёртку.
        const seen = new Set<string>();
        let bodies = [hookBody(source, hook, contract.file)];
        let text = "";
        for (let depth = 0; depth < 3 && bodies.length > 0; depth++) {
          text += bodies.join("\n");
          const called = bodies.flatMap((b) => [...b.matchAll(/\b([A-Za-z_]\w*)\(/g)].map((m) => m[1] as string));
          bodies = [];
          for (const name of called) {
            if (seen.has(name) || name === hook) continue;
            seen.add(name);
            const body = functionBody(source, name);
            if (body) bodies.push(body);
          }
        }
        const mark = MARKS.find((m) => text.includes(m));
        if (mark) {
          assert.ok(ACTIVE_COMPANY_SKIPS.has(kind), `${hook} зовёт «${mark}», а «${kind}» греется у активной компании`);
        }
      }
    }
  });
});

// ─── ЭКРАН ЗАНЯТ ─────────────────────────────────────────────────────

describe("экран занят — ждать ли прогреву", () => {
  test("в полёте только чтения самого прогрева, записей нет — свободно", () => {
    assert.equal(
      screensBusyFrom({
        fetchingHashes: ["warm-1", "warm-2"],
        warmingHashes: new Set(["warm-1", "warm-2"]),
        mutating: 0,
      }),
      false,
      "рабочие прогрева ждали бы друг друга и шли гуськом",
    );
  });

  test("рядом с прогревом летит чтение экрана — занято", () => {
    assert.equal(
      screensBusyFrom({
        fetchingHashes: ["warm-1", "screen-1"],
        warmingHashes: new Set(["warm-1"]),
        mutating: 0,
      }),
      true,
    );
  });

  test("чтений нет, но идёт запись — занято", () => {
    assert.equal(
      screensBusyFrom({ fetchingHashes: [], warmingHashes: new Set(), mutating: 1 }),
      true,
      "ответ прогрева между оптимистичной правкой и сохранением вернул бы старое",
    );
  });

  test("ничего не летит и не пишется — свободно", () => {
    assert.equal(
      screensBusyFrom({ fetchingHashes: [], warmingHashes: new Set(), mutating: 0 }),
      false,
    );
  });
});

// ─── ОЧЕРЕДЬ ─────────────────────────────────────────────────────────

/** Поддельные часы: `sleep` ставит пробуждение, драйвер будит по порядку. */
function fakeClock() {
  let now = 0;
  const sleepers: { at: number; seq: number; resolve: () => void }[] = [];
  let seq = 0;
  const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
  return {
    now: () => now,
    sleep: (ms: number) =>
      new Promise<void>((resolve) => {
        sleepers.push({ at: now + ms, seq: seq++, resolve });
      }),
    async run(done: Promise<unknown>): Promise<void> {
      let finished = false;
      void done.then(() => {
        finished = true;
      });
      for (let i = 0; i < 20_000; i++) {
        await flush();
        if (finished) return;
        sleepers.sort((a, b) => a.at - b.at || a.seq - b.seq);
        const next = sleepers.shift();
        if (!next) break;
        now = Math.max(now, next.at);
        next.resolve();
      }
      await flush();
      assert.ok(finished, "очередь не закончилась — повисла");
    },
  };
}

function queueOptions(
  clock: ReturnType<typeof fakeClock>,
  overrides: Partial<WarmQueueOptions<number>> = {},
): WarmQueueOptions<number> {
  return {
    concurrency: 2,
    needed: () => true,
    isBusy: () => false,
    shouldStop: () => false,
    now: clock.now,
    sleep: clock.sleep,
    pollMs: 50,
    settleMs: 0,
    maxWaitMs: 5_000,
    ...overrides,
  };
}

describe("очередь прогрева", () => {
  test("не больше двух чтений разом и в порядке списка", async () => {
    const clock = fakeClock();
    let inFlight = 0;
    let peak = 0;
    const order: number[] = [];
    const done = runWarmQueue(
      [0, 1, 2, 3, 4, 5],
      async (i) => {
        order.push(i);
        inFlight++;
        peak = Math.max(peak, inFlight);
        await clock.sleep(10 + i);
        inFlight--;
      },
      queueOptions(clock),
    );
    await clock.run(done);
    assert.equal(peak, 2);
    assert.deepEqual(order, [0, 1, 2, 3, 4, 5]);
  });

  test("ждёт, пока экран грузит, и начинает, когда тишина продержалась", async () => {
    const clock = fakeClock();
    const startedAt: number[] = [];
    const done = runWarmQueue(
      [0],
      async () => {
        startedAt.push(clock.now());
      },
      queueOptions(clock, { isBusy: () => clock.now() < 300, settleMs: 100 }),
    );
    await clock.run(done);
    assert.equal(startedAt.length, 1);
    assert.ok((startedAt[0] as number) >= 400, `начал в ${startedAt[0]}`);
    assert.ok((startedAt[0] as number) < 500, `начал в ${startedAt[0]}`);
  });

  test("экран занят вечно — ждёт не дольше 5 с и всё равно читает", async () => {
    const clock = fakeClock();
    const startedAt: number[] = [];
    const done = runWarmQueue(
      [0],
      async () => {
        startedAt.push(clock.now());
      },
      queueOptions(clock, { isBusy: () => true }),
    );
    await clock.run(done);
    assert.equal(startedAt.length, 1);
    assert.ok((startedAt[0] as number) >= 5_000 && (startedAt[0] as number) < 5_050, `начал в ${startedAt[0]}`);
  });

  test("компания сменилась — новых чтений нет, в том числе после ожидания", async () => {
    const clock = fakeClock();
    let moved = false;
    const started: number[] = [];
    const done = runWarmQueue(
      [0, 1, 2, 3, 4],
      async (i) => {
        started.push(i);
        await clock.sleep(10);
        moved = true;
      },
      queueOptions(clock, { shouldStop: () => moved }),
    );
    await clock.run(done);
    assert.deepEqual(started, [0, 1]);

    const clock2 = fakeClock();
    const started2: number[] = [];
    const done2 = runWarmQueue(
      [0],
      async (i) => {
        started2.push(i);
      },
      queueOptions(clock2, {
        isBusy: () => clock2.now() < 1_000,
        shouldStop: () => clock2.now() >= 100,
      }),
    );
    await clock2.run(done2);
    assert.deepEqual(started2, []);
  });

  test("тёплый ключ не стоит ожидания, а прогревшийся за ожидание — не читается", async () => {
    const clock = fakeClock();
    const startedAt: number[] = [];
    const done = runWarmQueue(
      [0, 1],
      async () => {
        startedAt.push(clock.now());
      },
      queueOptions(clock, { concurrency: 1, isBusy: () => true, needed: (i) => i !== 0 }),
    );
    await clock.run(done);
    // Одно ожидание (ради ключа 1), а не два.
    assert.equal(startedAt.length, 1);
    assert.ok((startedAt[0] as number) < 5_050, `начал в ${startedAt[0]}`);

    const clock2 = fakeClock();
    const started2: number[] = [];
    const done2 = runWarmQueue(
      [0],
      async (i) => {
        started2.push(i);
      },
      queueOptions(clock2, { isBusy: () => clock2.now() < 200, needed: () => clock2.now() < 100 }),
    );
    await clock2.run(done2);
    assert.deepEqual(started2, []);
  });
});
