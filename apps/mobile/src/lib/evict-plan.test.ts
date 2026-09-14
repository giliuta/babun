import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import {
  companyToOpenAfterEviction,
  isConfirmedNotMember,
  queryBelongsToCompany,
  queuedOpIdsOfCompany,
  storageKeysToEvict,
} from "./evict-plan";

// ЭТАП 0(ж) ПЛАНА ДОСТУПА: уволенного — данные компании уходят с телефона.
const X = "11365a87-bef9-4f6c-a030-b15083fe646b";
const A = "2bc7907e-b149-44a9-92ff-a5e73403031c";

describe("стирание уволенной компании с телефона", () => {
  test("ключи памяти: только именные ключи ЭТОЙ компании", () => {
    const keys = [
      `babun:tenant:onboarded:${X}`,
      `babun:tenant:onboarded:${A}`,
      `babun:pref:${X}:calendar.view`,
      `babun-contact-ways:${X}`,
      "babun:notifications:logical.v1",
      "babun:auth:active-tenant:user-1",
      `random:${X}`,
    ];
    assert.deepEqual(storageKeysToEvict(keys, X), [
      `babun:tenant:onboarded:${X}`,
      `babun:pref:${X}:calendar.view`,
      `babun-contact-ways:${X}`,
    ]);
  });

  test("запросы: только те, что называют компанию", () => {
    assert.equal(queryBelongsToCompany(["appointments", X, "master"], X), true);
    assert.equal(queryBelongsToCompany(["appointments", A, "owner"], X), false);
    assert.equal(queryBelongsToCompany(["my-calendars", "user-1"], X), false);
  });

  test("очередь: только операции этой компании", () => {
    const ops = [
      { id: 1, payload: { tenant_id: X } },
      { id: 2, payload: { tenant_id: A } },
      { id: 3, payload: {} },
      { id: 4, payload: { tenant_id: X } },
    ];
    assert.deepEqual(queuedOpIdsOfCompany(ops, X), [1, 4]);
  });

  test("куда увести: своя компания, иначе любая другая, иначе никуда", () => {
    const calendars = [
      { tenantId: X, role: "master", onboarded: true },
      { tenantId: "t3", role: "dispatcher", onboarded: true },
      { tenantId: A, role: "owner", onboarded: true },
    ];
    assert.equal(companyToOpenAfterEviction(calendars, X)?.tenantId, A);
    assert.equal(
      companyToOpenAfterEviction(calendars.filter((c) => c.tenantId !== A), X)?.tenantId,
      "t3",
    );
    assert.equal(companyToOpenAfterEviction([calendars[0]], X), null);
  });

  test("стираем только по подтверждённому «не состоит»", () => {
    assert.equal(isConfirmedNotMember({ data: null, error: null }), true);
    assert.equal(isConfirmedNotMember({ data: "master", error: null }), false);
    assert.equal(isConfirmedNotMember({ data: null, error: { message: "network" } }), false);
    assert.equal(isConfirmedNotMember({ data: undefined, error: null }), false);
  });

  test("исполнитель подтверждает до стирания; сигнал слушается; граница зовёт стирание", () => {
    const evict = readFileSync(join(__dirname, "evict-company.ts"), "utf8");
    const confirmAt = evict.indexOf("await confirmNotMember(tenantId)");
    const wipeAt = evict.indexOf("queryClient.removeQueries(");
    assert.ok(confirmAt > 0, "нет подтверждения у сервера");
    assert.ok(wipeAt > confirmAt, "стирание раньше подтверждения");

    const providers = readFileSync(join(__dirname, "../providers/AppProviders.tsx"), "utf8");
    assert.match(providers, /event: "membership_removed"/);
    assert.match(providers, /<AccessSignalsMount \/>/);

    const boundary = readFileSync(
      join(__dirname, "../features/settings/RoleCapabilityBoundary.tsx"),
      "utf8",
    );
    assert.match(boundary, /evictCompanyFromDevice\(tenantId\)/);
  });
});
