import assert from "node:assert/strict";
import { test } from "node:test";
import { withTimeout } from "./share-pdf";

// Печать PDF не крутится вечно: не дождались — понятная ошибка.

test("не дождались — ошибка с текстом", async () => {
  await assert.rejects(withTimeout(new Promise(() => {}), 20, "PDF собирался слишком долго."), {
    message: "PDF собирался слишком долго.",
  });
});

test("успели — значение как есть", async () => {
  assert.equal(await withTimeout(Promise.resolve("file://a.pdf"), 1000, "x"), "file://a.pdf");
});
