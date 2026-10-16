import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createCalendarSendQueue, queuedTeamIds, sendInOrder } from "./calendar-send-queue";

const here = dirname(fileURLToPath(import.meta.url));

/** Шаг тапа так, как его делает шторка «Команды»: набор от очереди, плюс команда. */
function tapAttach(queue: ReturnType<typeof createCalendarSendQueue>, shown: readonly string[], id: string) {
  const current = queuedTeamIds(queue, shown);
  return current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
}

describe("два быстрых тапа в шторке «Команды»", () => {
  test("второй тап до ответа не теряет первую команду", async () => {
    const queue = createCalendarSendQueue();
    const sent: (readonly string[])[] = [];
    const releases: (() => void)[] = [];
    const send = (ids: readonly string[]) =>
      new Promise<void>((done) => {
        sent.push(ids);
        releases.push(done);
      });
    // Карточка ещё рисует старый список: ответа на первый тап нет.
    const shown: readonly string[] = ["X"];
    const first = sendInOrder(queue, tapAttach(queue, shown, "A"), send);
    const second = sendInOrder(queue, tapAttach(queue, shown, "B"), send);
    await Promise.resolve();
    // Отправки по одной: вторая ждёт ответа на первую.
    assert.deepEqual(sent, [["X", "A"]]);
    releases[0]?.();
    await first;
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(sent, [["X", "A"], ["X", "A", "B"]]);
    releases[1]?.();
    await second;
    await new Promise((r) => setTimeout(r, 0));
    // Очередь пуста — правда снова в карточке.
    assert.equal(queue.latest, null);
  });

  test("отказ одной отправки не рвёт очередь", async () => {
    const queue = createCalendarSendQueue();
    const sent: (readonly string[])[] = [];
    const failing = sendInOrder(queue, ["A"], async (ids) => {
      sent.push(ids);
      throw new Error("нет");
    });
    const next = sendInOrder(queue, ["A", "B"], async (ids) => {
      sent.push(ids);
    });
    await assert.rejects(failing);
    await next;
    assert.deepEqual(sent, [["A"], ["A", "B"]]);
  });

  test("тоглер считает набор от очереди, а не от карточки", () => {
    const src = readFileSync(resolve(here, "member-calendar-toggle.ts"), "utf8");
    assert.match(src, /const current = queuedTeamIds\(calendarQueue, draft\.teamIds\);/);
    assert.match(src, /sendInOrder\(calendarQueue, next, \(ids\) => setCalendars\.mutateAsync\(ids\)\)/);
    assert.doesNotMatch(src, /const current = draft\.teamIds;/);
  });
});
