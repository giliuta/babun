// Сигналы календаря сотрудника: приватная тема ровно `calendar:<команда>`
// (её сверяет политика сервера), только своё событие, перечитка после
// обрыва и снятие всех каналов. Сеть не трогаем — `supabase` подменён.

import { describe, expect, test } from "bun:test";
import {
  CALENDAR_SIGNAL_EVENT,
  calendarSignalChange,
  startCalendarSignals,
} from "./calendar-signals";

class FakeChannel {
  topic: string;
  config: unknown;
  event: string | null = null;
  handler: ((message: { payload?: unknown }) => void) | null = null;
  statusCb: ((status: string) => void) | null = null;
  constructor(topic: string, config: unknown) {
    this.topic = topic;
    this.config = config;
  }
  on(_type: string, filter: { event: string }, cb: (message: { payload?: unknown }) => void): this {
    this.event = filter.event;
    this.handler = cb;
    return this;
  }
  subscribe(cb: (status: string) => void): this {
    this.statusCb = cb;
    return this;
  }
}

function fakeSupabase() {
  const channels: FakeChannel[] = [];
  const removed: FakeChannel[] = [];
  let authed = 0;
  const client = {
    channel: (topic: string, config: unknown) => {
      const c = new FakeChannel(topic, config);
      channels.push(c);
      return c;
    },
    removeChannel: async (c: FakeChannel) => {
      removed.push(c);
    },
    realtime: {
      setAuth: async () => {
        authed += 1;
      },
    },
  };
  return { client, channels, removed, authed: () => authed };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("startCalendarSignals", () => {
  test("one private channel per calendar, topic exactly calendar:<team>", async () => {
    const fake = fakeSupabase();
    startCalendarSignals({
      supabase: fake.client as never,
      teamIds: ["team-a", "team-b", "team-a", ""],
      onChange: () => {},
      onResync: () => {},
    });
    expect(fake.channels.map((c) => c.topic)).toEqual(["calendar:team-a", "calendar:team-b"]);
    for (const c of fake.channels) {
      expect(c.config).toEqual({ config: { private: true } });
      expect(c.event).toBe(CALENDAR_SIGNAL_EVENT);
    }
    // Подписка — только после передачи токена сокету.
    expect(fake.channels.every((c) => c.statusCb === null)).toBe(true);
    await flush();
    expect(fake.authed()).toBe(1);
    expect(fake.channels.every((c) => c.statusCb !== null)).toBe(true);
  });

  test("signal → change; resync only after a drop", async () => {
    const fake = fakeSupabase();
    const changes: unknown[] = [];
    let resyncs = 0;
    startCalendarSignals({
      supabase: fake.client as never,
      teamIds: ["team-a"],
      onChange: (c) => changes.push(c),
      onResync: () => {
        resyncs += 1;
      },
    });
    await flush();
    const ch = fake.channels[0];
    ch.handler?.({ payload: { id: "r1", updated_at: "2026-10-27T10:00:00Z", op: "UPDATE" } });
    expect(changes).toEqual([{ event: "UPDATE", id: "r1", updatedAt: "2026-10-27T10:00:00Z" }]);
    ch.statusCb?.("SUBSCRIBED");
    expect(resyncs).toBe(0);
    ch.statusCb?.("CHANNEL_ERROR");
    ch.statusCb?.("SUBSCRIBED");
    expect(resyncs).toBe(1);
    ch.statusCb?.("SUBSCRIBED");
    expect(resyncs).toBe(1);
  });

  test("stop removes every channel; stop before auth never subscribes", async () => {
    const fake = fakeSupabase();
    const stop = startCalendarSignals({
      supabase: fake.client as never,
      teamIds: ["team-a", "team-b"],
      onChange: () => {},
      onResync: () => {},
    });
    stop();
    await flush();
    expect(fake.removed.length).toBe(2);
    expect(fake.channels.every((c) => c.statusCb === null)).toBe(true);
  });

  test("no calendars — no channels", () => {
    const fake = fakeSupabase();
    startCalendarSignals({
      supabase: fake.client as never,
      teamIds: [],
      onChange: () => {},
      onResync: () => {},
    });
    expect(fake.channels.length).toBe(0);
  });
});

describe("calendarSignalChange", () => {
  test("reads only id / updated_at / op", () => {
    expect(calendarSignalChange({ id: "x", updated_at: null, op: "DELETE", client: "leak" })).toEqual({
      event: "DELETE",
      id: "x",
      updatedAt: null,
    });
  });
  test("garbage → null (full re-read)", () => {
    expect(calendarSignalChange(null)).toBeNull();
    expect(calendarSignalChange({ id: 5 })).toBeNull();
    expect(calendarSignalChange({ id: "" })).toBeNull();
  });
});
