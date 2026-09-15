import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { QueryClient } from "@tanstack/query-core";

import {
  claimResyncMatches,
  notifyClaimSettled,
  resyncAfterClaim,
  subscribeClaimSettled,
} from "./claim-resync-plan";

// ЧТО ЗДЕСЬ СТОРОЖИТСЯ. Пока claim в токене не догнал, realtime новой компании
// слеп, а после догона сам ничего не перечитывает. Догон теперь сообщает об
// успехе, и мост перечитывает ключи ИМЕННО этой компании — не трогая тёплые
// ключи другой: их пометка «протух» отправила бы возврат туда в сеть.

const AIRFIX = "2bc7907e-b149-44a9-92ff-a5e73403031c";
const GILIUTA = "11365a87-bef9-4f6c-a030-b15083fe646b";

function seededClient(): QueryClient {
  const qc = new QueryClient();
  for (const key of [
    ["appointments", AIRFIX, "owner"],
    ["appointments", GILIUTA, "master"],
    ["clients", GILIUTA, "master"],
    ["client", "c-1", GILIUTA, "master"],
    ["teams", GILIUTA, "master", "all"],
  ]) {
    qc.setQueryData(key, []);
  }
  return qc;
}

const invalidated = (qc: QueryClient, key: readonly unknown[]): boolean =>
  qc.getQueryState(key)?.isInvalidated === true;

describe("какие ключи перечитать после догона", () => {
  test("записи догнанной компании — да; записи другой и её команды — нет", () => {
    assert.equal(claimResyncMatches(["appointments", GILIUTA, "master"], "appointments", GILIUTA), true);
    assert.equal(claimResyncMatches(["appointments", AIRFIX, "owner"], "appointments", GILIUTA), false);
    assert.equal(claimResyncMatches(["teams", GILIUTA, "master", "all"], "appointments", GILIUTA), false);
  });

  test("догнали компанию моста — перечитываются её ключи realtime, чужие тёплые целы", async () => {
    const qc = seededClient();
    const requested = resyncAfterClaim(qc, {
      settledTenantId: GILIUTA,
      bridgeTenantId: GILIUTA,
      activeTenantId: GILIUTA,
    });
    await Promise.resolve();
    assert.equal(requested, true);
    assert.equal(invalidated(qc, ["appointments", GILIUTA, "master"]), true);
    assert.equal(invalidated(qc, ["clients", GILIUTA, "master"]), true);
    assert.equal(invalidated(qc, ["client", "c-1", GILIUTA, "master"]), true);
    assert.equal(
      invalidated(qc, ["appointments", AIRFIX, "owner"]),
      false,
      "тёплые записи другой компании помечены протухшими — возврат туда пойдёт в сеть",
    );
    assert.equal(invalidated(qc, ["teams", GILIUTA, "master", "all"]), false);
    qc.clear();
  });

  test("догнали B, а мост на A — не трогаем ничего", () => {
    const qc = seededClient();
    const requested = resyncAfterClaim(qc, {
      settledTenantId: GILIUTA,
      bridgeTenantId: AIRFIX,
      activeTenantId: AIRFIX,
    });
    assert.equal(requested, false);
    for (const query of qc.getQueryCache().getAll()) {
      assert.equal(query.state.isInvalidated, false, JSON.stringify(query.queryKey));
    }
    qc.clear();
  });

  test("устройство успело уйти из догнанной компании — не трогаем ничего", () => {
    const qc = seededClient();
    assert.equal(
      resyncAfterClaim(qc, {
        settledTenantId: GILIUTA,
        bridgeTenantId: GILIUTA,
        activeTenantId: AIRFIX,
      }),
      false,
    );
    assert.equal(invalidated(qc, ["appointments", GILIUTA, "master"]), false);
    qc.clear();
  });
});

describe("сообщение об успехе догона", () => {
  test("слушатель получает компанию; отписанный — нет; упавший не мешает другим", () => {
    const heard: string[] = [];
    const stopFailing = subscribeClaimSettled(() => {
      throw new Error("слушатель упал");
    });
    const stop = subscribeClaimSettled((tenantId) => heard.push(tenantId));
    notifyClaimSettled(GILIUTA);
    stop();
    stopFailing();
    notifyClaimSettled(AIRFIX);
    assert.deepEqual(heard, [GILIUTA]);
  });

  test("проводка: догон сообщает сразу после погашения долга, мост слушает и отписывается", () => {
    const catchUp = readFileSync(join(__dirname, "claim-catch-up.ts"), "utf8");
    assert.match(
      catchUp,
      /settlePendingClaim\(userId, tenantId\);\s*notifyClaimSettled\(tenantId\);\s*return true;/,
    );
    const bridge = readFileSync(join(__dirname, "sync-bridge.ts"), "utf8");
    assert.match(bridge, /const unsubClaim = subscribeClaimSettled\(/);
    assert.match(bridge, /resyncAfterClaim\(qc, \{/);
    assert.match(bridge, /subscriptions = \(\) => \{[^}]*unsubClaim\(\);[^}]*\};/);
  });
});
