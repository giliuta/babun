import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { bucketOf, countBuckets, dayTitle, filterHistory, groupByDay, matchesSearch } from "./sms-history-view";
import { parseSmsHistory } from "./sms-model";

const items = parseSmsHistory([
  { id: "1", created_at: "2026-09-29T10:00:00", status: "delivered", trigger: "manual", client_name: "Анна Петрова", to_phone: "+357 99 112233", body: "Ждём вас", cost_cents: 12 },
  { id: "2", created_at: "2026-09-29T08:00:00", status: "queued", trigger: "reminder", client_name: "Иван", to_phone: "+35790456747", template_body: "Напоминаем [Время]" },
  { id: "3", created_at: "2026-09-27T09:00:00", status: "blocked", trigger: "new_appointment", client_name: null, to_phone: "+35711111111", body: "Вы записаны" },
  { id: "4", created_at: "2026-09-27T08:00:00", status: "sent", trigger: "manual", client_name: "Анна Петрова", to_phone: "+357 99 112233", body: "Спасибо", cost_cents: 24 },
]);

describe("история SMS — плитки, поиск, дни", () => {
  test("итог сообщения — одна из трёх плиток", () => {
    assert.equal(bucketOf("delivered"), "delivered");
    assert.equal(bucketOf("sent"), "waiting");
    assert.equal(bucketOf("queued"), "waiting");
    assert.equal(bucketOf("undelivered"), "failed");
    assert.equal(bucketOf("blocked"), "failed");
    assert.deepEqual(countBuckets(items), { all: 4, delivered: 1, waiting: 2, failed: 1 });
  });

  test("поиск: имя, текст, номер цифрами", () => {
    assert.ok(matchesSearch(items[0]!, "анна"));
    assert.ok(matchesSearch(items[1]!, "напоминаем"));
    assert.ok(matchesSearch(items[1]!, "456 747"));
    assert.ok(!matchesSearch(items[2]!, "анна"));
    assert.deepEqual(filterHistory(items, "waiting", "анна").map((i) => i.id), ["4"]);
    assert.deepEqual(filterHistory(items, "all", "").map((i) => i.id), ["1", "2", "3", "4"]);
  });

  test("дни: сегодня, позавчера — днём недели; итог дня", () => {
    const now = new Date("2026-09-29T12:00:00");
    const days = groupByDay(items, now);
    assert.deepEqual(days.map((d) => [d.title, d.count, d.cents]), [
      ["СЕГОДНЯ", 2, 12],
      ["ВС, 27 СЕНТЯБРЯ", 2, 24],
    ]);
    assert.equal(dayTitle(new Date("2026-09-28T09:00:00"), now), "ВЧЕРА");
    assert.equal(dayTitle(new Date("2025-12-31T09:00:00"), now), "СР, 31 ДЕКАБРЯ 2025");
  });
});
