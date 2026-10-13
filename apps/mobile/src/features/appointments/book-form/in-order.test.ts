import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { Fragment, isValidElement } from "react";
import { inOrder } from "./in-order";

describe("inOrder", () => {
  test("renders the parts in the team's order, each under its own key", () => {
    const out = inOrder(["b", "a"] as const, { a: "A", b: "B" });
    assert.ok(Array.isArray(out));
    const nodes = out as unknown[];
    assert.equal(nodes.length, 2);
    const [first, second] = nodes;
    assert.ok(isValidElement(first) && isValidElement(second));
    assert.equal(first.type, Fragment);
    assert.equal(first.key, "b");
    assert.equal(second.key, "a");
    assert.equal((first.props as { children: string }).children, "B");
  });

  test("a block without a part renders nothing in its slot", () => {
    const nodes = inOrder(["a", "b"] as const, { b: "B" }) as unknown[];
    assert.equal(nodes[0], null);
    assert.ok(isValidElement(nodes[1]));
  });

  test("a part given as null still takes its slot (the block decides itself)", () => {
    const nodes = inOrder(["a"] as const, { a: null }) as unknown[];
    assert.ok(isValidElement(nodes[0]));
  });
});
