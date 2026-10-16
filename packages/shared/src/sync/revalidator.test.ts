import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createRevalidator } from "./revalidator";
import { subscribeRevalidated } from "./revalidate-events";

function deferred() {
  let resolve!: (changed: boolean) => void;
  const promise = new Promise<boolean>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("createRevalidator", () => {
  test("a second request for the same company joins the run in flight", async () => {
    let calls = 0;
    const gate = deferred();
    const r = createRevalidator<null>("clients", () => {
      calls += 1;
      return gate.promise;
    });
    const a = r.revalidate(null, "t1");
    const b = r.revalidate(null, "t1");
    assert.equal(a, b);
    gate.resolve(false);
    await a;
    assert.equal(calls, 1);
  });

  test("a run marked stale is followed by one more run", async () => {
    let calls = 0;
    const r = createRevalidator<null>("clients", async () => {
      calls += 1;
      return false;
    });
    const first = r.revalidate(null, "t1");
    r.markStale("t1");
    await first;
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(calls, 2);
  });

  test("emits revalidated only when the cache changed, and swallows errors", async () => {
    const seen: string[] = [];
    const off = subscribeRevalidated((table) => seen.push(table));
    try {
      await createRevalidator<null>("tags", async () => false).revalidate(null, "t1");
      await createRevalidator<null>("tags", async () => true).revalidate(null, "t1");
      await createRevalidator<null>("tags", async () => {
        throw new Error("offline");
      }).revalidate(null, "t1");
    } finally {
      off();
    }
    assert.deepEqual(seen, ["tags"]);
  });
});
