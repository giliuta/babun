import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { invitationWait, waitSubtitle } from "./invitation-wait";

const NOW = new Date("2026-09-21T12:00:00Z");
const inDays = (days: number, hours = 0) =>
  new Date(NOW.getTime() + days * 86_400_000 + hours * 3_600_000).toISOString();

describe("сколько ждёт приглашение", () => {
  test("считаем полными днями", () => {
    assert.equal(invitationWait(inDays(3), NOW).text, "осталось 3 дня");
    assert.equal(invitationWait(inDays(1), NOW).text, "осталось 1 день");
    assert.equal(invitationWait(inDays(7), NOW).text, "осталось 7 дней");
    // 2 дня и 23 часа — это ещё два полных дня, а не три.
    assert.equal(invitationWait(inDays(2, 23), NOW).text, "осталось 2 дня");
  });

  test("последний день называется словом", () => {
    const wait = invitationWait(inDays(0, 5), NOW);
    assert.equal(wait.kind, "last-day");
    assert.equal(wait.text, "сегодня последний день");
  });

  test("истёкшее так и говорит", () => {
    const wait = invitationWait(inDays(-1), NOW);
    assert.equal(wait.kind, "expired");
    assert.equal(wait.text, "срок истёк");
  });

  test("нечитаемая дата молчит, а не пугает", () => {
    assert.equal(invitationWait("не дата", NOW).text, "");
    assert.equal(waitSubtitle("не дата", NOW), "ждёт ответа");
    assert.equal(waitSubtitle(null, NOW), "ждёт ответа");
    assert.equal(waitSubtitle(undefined, NOW), "ждёт ответа");
  });

  test("подпись строки склеивается через точку", () => {
    assert.equal(waitSubtitle(inDays(3), NOW), "ждёт ответа · осталось 3 дня");
    assert.equal(waitSubtitle(inDays(-2), NOW), "ждёт ответа · срок истёк");
  });
});
