// СКОЛЬКО ЖДЁТ ОТПРАВКИ — ВСЁ ИЛИ ТОЛЬКО ВИДИМОЕ. Очередь одна на телефон, а
// экран «Синхронизация» показывает операции открытой компании; цифра в
// кабинете обязана считаться тем же фильтром.
//
// Run: cd packages/shared && bun test src/sync/queue-depth.test.ts

import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { MemorySqlAdapter } from "../storage/sql/memory";
import { setSql } from "../storage/sql/provider";
import { __resetCacheForTests, enqueueOp, type QueuedOp } from "../db/cache/sql";
import { countQueuedOps } from "./queue-events";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

test("без фильтра — вся очередь, с фильтром — только прошедшие", async () => {
  setSql(new MemorySqlAdapter(new Database(":memory:")));
  __resetCacheForTests();
  const op = (row: string, tenant: string | null) =>
    enqueueOp({
      table: "clients",
      op: "update",
      row_id: row,
      payload: tenant ? { tenant_id: tenant } : {},
      expected_updated_at: null,
    });
  await op("r1", A);
  await op("r2", B);
  await op("r3", B);
  await op("r4", null);
  const ofA = (o: QueuedOp) => {
    const tenant = o.payload.tenant_id;
    return typeof tenant !== "string" || tenant === A;
  };
  expect(await countQueuedOps()).toBe(4);
  expect(await countQueuedOps(ofA)).toBe(2);
});
