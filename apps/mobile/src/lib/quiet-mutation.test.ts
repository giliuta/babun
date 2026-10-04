import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { runDetachedMutation } from "./quiet-mutation";

// Два переноса подряд: отказ сервера на ПЕРВОМ обязан дойти до его отклика,
// даже если второй вызов ушёл раньше ответа.

describe("runDetachedMutation", () => {
  test("отклик первого вызова звучит, когда за ним уже ушёл второй", async () => {
    const qc = new QueryClient();
    const releases: ((ok: boolean) => void)[] = [];
    const options = {
      mutationFn: (_vars: string) =>
        new Promise<string>((resolve, reject) => {
          releases.push((ok) => (ok ? resolve("ok") : reject(new Error("refused"))));
        }),
    };
    const events: string[] = [];
    const first = runDetachedMutation(qc, options, "a", {
      onError: () => events.push("first:error"),
      onSuccess: () => events.push("first:success"),
    });
    const second = runDetachedMutation(qc, options, "b", {
      onError: () => events.push("second:error"),
      onSuccess: () => events.push("second:success"),
    });
    await new Promise((r) => setTimeout(r, 10));
    releases[0]?.(false);
    releases[1]?.(true);
    await first;
    await second;
    assert.deepEqual(events.sort(), ["first:error", "second:success"]);
  });
});
