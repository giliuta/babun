// Очередь правок сотрудника на настоящем SQLite (bun:sqlite): порядок
// постановки, отказ и повтор, хвост пачки, стирание с выходом и с компанией.

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { MemorySqlAdapter } from "../../../storage/sql/memory";
import { setSql } from "../../../storage/sql/provider";
import {
  __resetCacheForTests,
  cacheClearAll,
  clearMemberOpsOfTenant,
  enqueueMemberOp,
  hasMemberOps,
  listMemberOps,
  markMemberOpRefused,
  memberQueueDepth,
  noteMemberOpAttempt,
  removeMemberOp,
  replaceMemberOpArgs,
  retryMemberOp,
} from "../sql";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

beforeEach(() => {
  setSql(new MemorySqlAdapter(new Database(":memory:")));
  __resetCacheForTests();
});

afterEach(() => {
  __resetCacheForTests();
});

const op = (record: string, kind = "update", tenant = A) => ({
  tenant_id: tenant,
  record_id: record,
  kind,
  args: { p_appointment_id: record, p_patch: { comment: kind } },
  label: "Заметка записи",
});

describe("member_queue", () => {
  test("keeps insertion order and the whole call", async () => {
    await enqueueMemberOp(op("r1", "create"));
    await enqueueMemberOp(op("r2"));
    await enqueueMemberOp(op("r1", "update"));
    const ops = await listMemberOps();
    expect(ops.map((o) => [o.record_id, o.kind])).toEqual([
      ["r1", "create"],
      ["r2", "update"],
      ["r1", "update"],
    ]);
    expect(ops[0].args).toEqual({ p_appointment_id: "r1", p_patch: { comment: "create" } });
    expect(ops[0].refused).toBe(false);
    expect(await memberQueueDepth()).toBe(3);
    expect(await hasMemberOps("r1")).toBe(true);
    expect(await hasMemberOps("r9")).toBe(false);
  });

  test("attempt, refusal with words, manual retry, removal", async () => {
    await enqueueMemberOp(op("r1"));
    const [first] = await listMemberOps();
    await noteMemberOpAttempt(first.id, "Network request failed");
    let [row] = await listMemberOps();
    expect(row.attempts).toBe(1);
    expect(row.refused).toBe(false);
    await markMemberOpRefused(first.id, "Нет права «Заметка» в этом календаре");
    [row] = await listMemberOps();
    expect(row.refused).toBe(true);
    expect(row.last_error).toBe("Нет права «Заметка» в этом календаре");
    await retryMemberOp(first.id);
    [row] = await listMemberOps();
    expect(row.refused).toBe(false);
    expect(row.attempts).toBe(0);
    expect(row.last_error).toBeNull();
    await removeMemberOp(first.id);
    expect(await memberQueueDepth()).toBe(0);
  });

  test("a partly sent batch keeps only its tail", async () => {
    await enqueueMemberOp({ ...op("r1", "photos"), args: { assets: ["a", "b", "c"] } });
    const [first] = await listMemberOps();
    await replaceMemberOpArgs(first.id, { assets: ["c"] });
    expect((await listMemberOps())[0].args).toEqual({ assets: ["c"] });
  });

  test("sign-out wipes it; evicting a company takes only that company", async () => {
    await enqueueMemberOp(op("r1", "update", A));
    await enqueueMemberOp(op("r2", "update", B));
    await clearMemberOpsOfTenant(A);
    expect((await listMemberOps()).map((o) => o.tenant_id)).toEqual([B]);
    await cacheClearAll();
    expect(await memberQueueDepth()).toBe(0);
  });
});
