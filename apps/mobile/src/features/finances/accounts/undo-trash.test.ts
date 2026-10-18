import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { undoAccountTrash } from "./undo-trash";

function recorder() {
  const calls: string[] = [];
  return {
    calls,
    ops: {
      restore: async (id: string) => void calls.push(`restore:${id}`),
      close: async (id: string) => void calls.push(`close:${id}`),
    },
  };
}

describe("undoAccountTrash — счёт возвращается таким, каким его удалили", () => {
  test("закрытый остаётся закрытым", async () => {
    const r = recorder();
    await undoAccountTrash({ id: "a", is_active: false }, r.ops);
    assert.deepEqual(r.calls, ["restore:a", "close:a"]);
  });

  test("открытый просто возвращается", async () => {
    const r = recorder();
    await undoAccountTrash({ id: "a", is_active: true }, r.ops);
    assert.deepEqual(r.calls, ["restore:a"]);
  });

  test("тосты «Отменить» удаления зовут отмену, а не голое восстановление", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    for (const file of ["../account-editor/use-close-flow.ts", "../accounts-page/use-hide-account.tsx"]) {
      const code = readFileSync(resolve(here, file), "utf8");
      assert.match(code, /undoTrash\.mutate\(target,/, file);
      assert.doesNotMatch(code, /restoreAcc\.mutate\(/, file);
    }
  });
});
