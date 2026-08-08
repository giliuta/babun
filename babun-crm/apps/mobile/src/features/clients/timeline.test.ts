import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Appointment } from "@babun/shared/local/appointments";
import type { Client } from "@babun/shared/local/clients";
import { createBlankClient } from "@babun/shared/local/clients";
import { buildTimeline } from "./timeline";

// Лента — то, что читают ПЕРЕД звонком. Пропущенное событие здесь означает
// разговор вслепую: «вы же обещали приехать» против «ничего не вижу».

const name = (id: string) => (id === "s1" ? "Мойка" : null);

const client = (over: Partial<Client>): Client =>
  ({ ...createBlankClient(), id: "c1", created_at: "2026-01-01T00:00:00Z", ...over }) as Client;

const apt = (over: Partial<Appointment>): Appointment =>
  ({
    id: "a1",
    date: "2026-06-01",
    time_start: "10:00",
    status: "completed",
    kind: "work",
    services: [],
    service_ids: ["s1"],
    total_amount: 100,
    paid_amount: 100,
    ...over,
  }) as Appointment;

describe("лента клиента", () => {
  test("визиты, заметки и напоминание в одной нити, свежее сверху", () => {
    const events = buildTimeline(
      client({
        notes: [{ id: "n1", text: "Просила перезвонить", created_at: "2026-07-01T09:00:00Z" }],
        reminder_at: "2026-08-01T09:00:00Z",
      }),
      [apt({})],
      name,
    );
    assert.deepEqual(events.map((e) => e.kind), ["reminder", "note", "visit"]);
  });

  test("услуги визита становятся заголовком", () => {
    const [visit] = buildTimeline(client({}), [apt({})], name);
    assert.equal(visit?.title, "Мойка");
  });

  test("недоплата показывается долгом", () => {
    const [visit] = buildTimeline(
      client({}),
      [apt({ total_amount: 100, paid_amount: 40 })],
      name,
    );
    assert.equal(visit?.debt, 60);
  });

  test("отменённый визит остаётся в истории, но помечен", () => {
    const [visit] = buildTimeline(
      client({}),
      [apt({ status: "cancelled", total_amount: 100, paid_amount: 0 })],
      name,
    );
    assert.equal(visit?.cancelled, true);
    assert.equal(visit?.debt, 0);
  });

  test("личные события календаря в историю клиента не попадают", () => {
    const events = buildTimeline(client({}), [apt({ kind: "event" })], name);
    assert.equal(events.length, 0);
  });

  test("импортированная заметка не теряется", () => {
    const events = buildTimeline(client({ comment: "Скидка 10%" }), [], name);
    assert.equal(events[0]?.title, "Скидка 10%");
    assert.equal(events[0]?.subtitle, "из импорта");
  });

  test("внутри дня визиты идут по времени сверху вниз", () => {
    const events = buildTimeline(
      client({}),
      [
        apt({ id: "morning", time_start: "09:00" }),
        apt({ id: "evening", time_start: "18:00" }),
      ],
      name,
    );
    assert.deepEqual(events.map((e) => e.time), ["18:00", "09:00"]);
  });
});
