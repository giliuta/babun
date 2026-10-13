import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { readModuleSource } from "@/lib/module-source";

// The screen is the thin route plus this folder (`InventoryList.tsx`).
const here = dirname(fileURLToPath(import.meta.url));
const source = readModuleSource(
  resolve(here, "../../../app/(dashboard)/cabinet/inventory.tsx"),
  here,
);

describe("inventory destructive flow", () => {
  test("closes an open editor only after the server confirms deletion", () => {
    const removeStart = source.indexOf("const remove =");
    const removeEnd = source.indexOf("\n\n  return (", removeStart);
    assert.notEqual(removeStart, -1);
    assert.notEqual(removeEnd, -1);
    const remove = source.slice(removeStart, removeEnd);

    const mutate = remove.indexOf("save.mutate(");
    const success = remove.indexOf("onSuccess: () => onConfirm?.()", mutate);
    assert.ok(mutate >= 0);
    assert.ok(success > mutate);
    assert.doesNotMatch(remove.slice(0, mutate), /onConfirm\?\.\(\)/);
  });
});
