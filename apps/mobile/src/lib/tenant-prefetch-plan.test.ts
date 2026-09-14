import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { planCompanyGate, planCompanyWarm } from "./tenant-prefetch-plan";
import { keyNamesKnownTenant, querySurvivesSwitch } from "./tenant-query-keys";

const T = "11365a87-bef9-4f6c-a030-b15083fe646b";
const OTHER = "2bc7907e-b149-44a9-92ff-a5e73403031c";
const PERIOD = { from: "2026-09-01", to: "2026-09-30" };

const keysOf = (targets: { queryKey: readonly unknown[] }[]) =>
  targets.map((t) => JSON.stringify(t.queryKey));

describe("план прогрева другой компании", () => {
  test("первая волна — ровно то, чего ждёт гейт и границы прав", () => {
    assert.deepEqual(keysOf(planCompanyGate({ tenantId: T, role: "master" })), [
      JSON.stringify(["tenant", T, "master"]),
      JSON.stringify(["calendar-settings", T, "master"]),
      JSON.stringify(["teams", T, "master"]),
      JSON.stringify(["teams", T, "master", "all"]),
    ]);
  });

  test("владелец с двумя командами: календарь → клиенты → кабинет → деньги", () => {
    const plan = planCompanyWarm({
      tenantId: T,
      role: "owner",
      teamIds: ["team-a", "team-b"],
      period: PERIOD,
      canViewFinances: true,
    });
    assert.deepEqual(
      keysOf(plan),
      [
        ["appointments", T, "owner"],
        ["services", T, "owner"],
        ["services", "with-archived", T, "owner"],
        ["cities", T, "live", null],
        ["cities", T, "live", "team-a"],
        ["cities", T, "live", "team-b"],
        ["day-cities", T, "owner"],
        ["team-schedules", T, "owner", "team-a"],
        ["team-schedules", T, "owner", "team-b"],
        ["team-schedules", T, "owner", "all"],
        ["day-extras", T, "owner"],
        ["clients", T, "owner"],
        ["client-tags", T, "owner"],
        ["masters", T, "owner"],
        ["masters", T, "owner", "all"],
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

  test("мастер: ключи его роли, без ручных операций, сводного расписания и денег", () => {
    const plan = planCompanyWarm({
      tenantId: T,
      role: "master",
      teamIds: ["team-a"],
      period: PERIOD,
      canViewFinances: false,
    });
    const kinds = plan.map((t) => t.kind);
    assert.ok(kinds.includes("appointments"));
    assert.ok(!kinds.includes("day-extras"));
    assert.ok(!kinds.includes("team-schedules-all"));
    assert.ok(!kinds.some((k) => k.startsWith("account") || k === "transactions"));
    for (const t of plan) {
      // Ключ роли — «master», а не «owner» и не «role-pending»: экран мастера
      // спросит ровно его, и «role-pending» он не спросит никогда.
      assert.ok(!t.queryKey.includes("owner"), JSON.stringify(t.queryKey));
      assert.ok(!t.queryKey.includes("role-pending"), JSON.stringify(t.queryKey));
    }
  });

  test("каждый ключ называет СВОЮ компанию — и потому переживает переход", () => {
    const all = [
      ...planCompanyGate({ tenantId: T, role: "owner" }),
      ...planCompanyWarm({
        tenantId: T,
        role: "owner",
        teamIds: ["team-a"],
        period: PERIOD,
        canViewFinances: true,
      }),
    ];
    for (const t of all) {
      assert.ok(keyNamesKnownTenant(t.queryKey, [T]), JSON.stringify(t.queryKey));
      assert.ok(querySurvivesSwitch(t.queryKey, [T, OTHER]));
      // И не называет чужую: иначе чистка при уходе из OTHER берегла бы его
      // по ошибке, а прогретые данные одной компании легли бы под ключ другой.
      assert.ok(!keyNamesKnownTenant(t.queryKey, [OTHER]));
    }
  });

  test("срез журнала несёт свои границы, чтобы исполнитель читал тот же месяц", () => {
    const [tx] = planCompanyWarm({
      tenantId: T,
      role: "owner",
      teamIds: [],
      period: PERIOD,
      canViewFinances: true,
    }).filter((t) => t.kind === "transactions");
    assert.equal(tx?.from, PERIOD.from);
    assert.equal(tx?.to, PERIOD.to);
  });
});
