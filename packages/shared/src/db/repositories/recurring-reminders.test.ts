import { describe, expect, test } from "bun:test";
import {
  deleteRecurringReminder,
  updateReminderStatus,
} from "./recurring-reminders";

function writeStub(data: { id: string } | null, error: unknown = null) {
  const calls: string[] = [];
  const chain: Record<string, unknown> = {};
  chain.update = () => {
    calls.push("update");
    return chain;
  };
  chain.delete = () => {
    calls.push("delete");
    return chain;
  };
  chain.eq = () => chain;
  chain.select = () => {
    calls.push("select");
    return chain;
  };
  chain.maybeSingle = () => Promise.resolve({ data, error });
  return {
    client: { from: () => chain } as never,
    calls,
  };
}

describe("recurring reminder write confirmation", () => {
  test("status update succeeds only when the server returns the row", async () => {
    const ok = writeStub({ id: "reminder-a" });
    await updateReminderStatus(ok.client, "reminder-a", "booked");
    expect(ok.calls).toEqual(["update", "select"]);

    const hidden = writeStub(null);
    await expect(
      updateReminderStatus(hidden.client, "reminder-a", "booked"),
    ).rejects.toThrow("не найдено или доступ запрещён");
  });

  test("delete cannot report success for a missing or RLS-hidden row", async () => {
    const hidden = writeStub(null);
    await expect(
      deleteRecurringReminder(hidden.client, "reminder-a"),
    ).rejects.toThrow("не найдено или доступ запрещён");
    expect(hidden.calls).toEqual(["delete", "select"]);
  });
});
