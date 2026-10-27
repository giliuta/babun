import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { reminderToast } from "./reminder-toast";

type Call = [string, string | undefined];

function record() {
  const calls: Call[] = [];
  const toast = (message: string, type?: string) => {
    calls.push([message, type]);
  };
  return { calls, toast };
}

describe("reminderToast", () => {
  test("every outcome speaks once, with its tone", () => {
    const cases: [Parameters<typeof reminderToast>[1], Call][] = [
      ["cleared", ["Напоминание снято", "info"]],
      ["denied", ["Разрешите уведомления в Настройках", "error"]],
      ["past", ["Это время уже прошло", "info"]],
      ["deferred", ["Напоминание в очереди — установится, когда на iPhone освободится место", "info"]],
      ["capacity", ["Очередь напоминаний переполнена", "error"]],
      ["unavailable", ["Появится после обновления приложения", "info"]],
    ];
    for (const [res, expected] of cases) {
      const { calls, toast } = record();
      reminderToast(toast, res, null);
      assert.deepEqual(calls, [expected], String(res));
    }
  });

  test("scheduled names the rule in lower case; without a rule — silence", () => {
    const { calls, toast } = record();
    reminderToast(toast, "scheduled", { kind: "dayAt", daysBefore: 1, time: "20:00" });
    assert.deepEqual(calls, [["Напомню накануне в 20:00", undefined]]);

    const silent = record();
    reminderToast(silent.toast, "scheduled", null);
    assert.deepEqual(silent.calls, []);
  });

  test("on Android the queue names the phone, not an iPhone", () => {
    const { calls, toast } = record();
    reminderToast(toast, "deferred", null, true);
    assert.deepEqual(calls, [
      ["Напоминание в очереди — установится, когда на телефоне освободится место", "info"],
    ]);
  });

  test("«denied» leads to the phone's Settings when the caller can open them (CAL-40)", () => {
    const calls: unknown[][] = [];
    let opened = 0;
    reminderToast(
      ((...args: unknown[]) => calls.push(args)) as never,
      "denied",
      null,
      false,
      () => (opened += 1),
    );
    const [message, type, action] = calls[0] as [string, string, { label: string; onPress: () => void }];
    assert.equal(message, "Разрешите уведомления в Настройках");
    assert.equal(type, "error");
    assert.equal(action.label, "Настройки");
    action.onPress();
    assert.equal(opened, 1);
  });
});
