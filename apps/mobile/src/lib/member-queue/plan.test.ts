import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { MemberQueuedOp } from "@babun/shared/db/cache/sql";
import type { Appointment } from "@babun/shared/local/appointments";
import {
  heldBehindRefusal,
  isMemberQueued,
  MEMBER_QUEUED,
  memberOpLabel,
  nextMemberOp,
  overlayMemberOps,
  retryDelayMs,
  sendFailure,
} from "./plan";

const A = "tenant-a";
const B = "tenant-b";

let seq = 0;
function op(over: Partial<MemberQueuedOp>): MemberQueuedOp {
  seq += 1;
  return {
    id: seq,
    created_at: seq,
    tenant_id: A,
    record_id: "r1",
    kind: "update",
    args: {},
    label: "",
    attempts: 0,
    last_error: null,
    refused: false,
    ...over,
  };
}

const apt = (id: string, over: Partial<Appointment> = {}) =>
  ({ id, date: "2026-10-27", time_start: "10:00", time_end: "11:00", comment: "", ...over }) as Appointment;

describe("nextMemberOp", () => {
  test("queue order, only the open company", () => {
    const ops = [op({ tenant_id: B, record_id: "x" }), op({ record_id: "r2" }), op({ record_id: "r1" })];
    assert.equal(nextMemberOp(ops, A)?.record_id, "r2");
    assert.equal(nextMemberOp(ops, B)?.record_id, "x");
    assert.equal(nextMemberOp(ops, null), null);
  });

  test("a refusal holds the rest of ITS record, other records go on", () => {
    const refused = op({ record_id: "r1", refused: true });
    const later = op({ record_id: "r1" });
    const other = op({ record_id: "r2" });
    assert.equal(nextMemberOp([refused, later, other], A)?.id, other.id);
    assert.deepEqual([...heldBehindRefusal([refused, later, other])], [later.id]);
    assert.equal(nextMemberOp([refused, later], A), null);
  });
});

describe("sendFailure", () => {
  test("dropped connection, timeout, 5xx and an expired login wait for the network", () => {
    for (const error of [
      new TypeError("Network request failed"),
      { message: "FetchError: fetch failed" },
      { message: "Bad Gateway", status: 502 },
      { message: "JWT expired" },
    ]) {
      assert.equal(sendFailure(error).kind, "offline", JSON.stringify(error));
    }
  });

  test("an answer of the server is a refusal", () => {
    for (const message of [
      "access:block:record.note",
      "appointment not found or not in your calendars",
      "duplicate key value violates unique constraint",
    ]) {
      assert.equal(sendFailure({ message }).kind, "refused", message);
    }
  });
});

describe("overlayMemberOps", () => {
  test("a queued move stays on screen after a re-read", () => {
    const list = [apt("r1"), apt("r2")];
    const ops = [op({ record_id: "r1", args: { view: { time_start: "14:00", time_end: "15:00" } } })];
    const out = overlayMemberOps(list, ops, A);
    assert.equal(out.find((a) => a.id === "r1")?.time_start, "14:00");
    assert.equal(out.find((a) => a.id === "r2")?.time_start, "10:00");
    assert.equal(list[0].time_start, "10:00", "server list is not mutated");
  });

  test("a queued new record appears, a queued delete disappears", () => {
    const ops = [
      op({ kind: "create", record_id: "new", args: { view: apt("new", { comment: "в подвале" }) } }),
      op({ kind: "trash", record_id: "r2" }),
    ];
    const out = overlayMemberOps([apt("r1"), apt("r2")], ops, A);
    assert.deepEqual(out.map((a) => a.id).sort(), ["new", "r1"]);
  });

  test("a refused edit and another company's edit are not shown", () => {
    const ops = [
      op({ record_id: "r1", refused: true, args: { view: { comment: "отказ" } } }),
      op({ record_id: "r1", tenant_id: B, args: { view: { comment: "чужое" } } }),
    ];
    assert.equal(overlayMemberOps([apt("r1")], ops, A)[0].comment, "");
  });

  test("an edit of a record that is not in the list does not invent it", () => {
    const ops = [op({ record_id: "gone", args: { view: { comment: "x" } } })];
    assert.deepEqual(overlayMemberOps([apt("r1")], ops, A).map((a) => a.id), ["r1"]);
  });
});

describe("words and pauses", () => {
  test("labels name the edit", () => {
    assert.equal(memberOpLabel({ kind: "update", args: { p_patch: { date: "x", time_start: "y" } } }), "Перенос записи");
    assert.equal(memberOpLabel({ kind: "update", args: { p_patch: { comment: "x" } } }), "Заметка записи");
    assert.equal(memberOpLabel({ kind: "update", args: { p_patch: { comment: "x", status: "y" } } }), "Правка записи");
    assert.equal(memberOpLabel({ kind: "pay", args: {} }), "Оплата записи");
    assert.equal(memberOpLabel({ kind: "photos", args: {} }), "Фото записи");
  });

  test("retry pause grows and stops growing", () => {
    assert.deepEqual([1, 2, 3, 9].map(retryDelayMs), [5_000, 15_000, 60_000, 60_000]);
  });

  test("queued marker", () => {
    assert.equal(isMemberQueued(MEMBER_QUEUED), true);
    assert.equal(isMemberQueued(null), false);
    assert.equal(isMemberQueued({ id: "x" }), false);
  });
});
