// STORY-062 slice 5 — unit tests for the realtime tenant-sync bridge.
//
// The revalidateBridge test already covers the SQLite/signature side of the
// read-path freshness machinery. This file covers the OTHER freshness source:
// `startRealtimeTenantSync`, the most sensitive part (cross-tenant subscription
// + reconnect backfill + teardown). We stub `supabase.channel()` so no network
// is touched and assert the contract:
//   * one channel per subscribed table (clients / appointments / client_tags);
//   * the postgres_changes filter carries the ACTIVE tenant_id (no cross-tenant
//     subscription);
//   * a change event fires onChange with the CACHE-vocab table name
//     (client_tags → tags);
//   * a CLOSED→SUBSCRIBED transition fires onResync exactly once, while a
//     steady-state SUBSCRIBED does not;
//   * the returned unsubscribe removes EVERY channel;
//   * a null tenant no-ops (logged-out / pre-onboarding) and opens no channels.
//
// Run: cd packages/shared && bun test src/sync/realtime.test.ts

import { describe, expect, test } from "bun:test";
import { startRealtimeTenantSync } from "./realtime";

const TENANT = "11111111-1111-1111-1111-111111111111";

interface PgChangesConfig {
  event: string;
  schema: string;
  table: string;
  filter: string;
}

/** A single fake channel that records its postgres_changes config, its change
 *  handler, and its subscribe status callback — so a test can drive events. */
class FakeChannel {
  name: string;
  config: PgChangesConfig | null = null;
  onChange: (() => void) | null = null;
  statusCb: ((status: string) => void) | null = null;

  constructor(name: string) {
    this.name = name;
  }

  on(_event: string, config: PgChangesConfig, cb: () => void): this {
    this.config = config;
    this.onChange = cb;
    return this;
  }

  subscribe(cb: (status: string) => void): this {
    this.statusCb = cb;
    return this;
  }

  /** Test helper: drive a subscribe-status transition. */
  emitStatus(status: string): void {
    this.statusCb?.(status);
  }
}

/** Minimal supabase stub exposing channel() + removeChannel() as spies. */
function supabaseStub() {
  const channels: FakeChannel[] = [];
  const removed: FakeChannel[] = [];
  const stub = {
    channel(name: string): FakeChannel {
      const ch = new FakeChannel(name);
      channels.push(ch);
      return ch;
    },
    removeChannel(ch: FakeChannel): void {
      removed.push(ch);
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { supabase: stub as any, channels, removed };
}

describe("startRealtimeTenantSync", () => {
  test("opens one tenant-filtered channel per table (clients/appointments/client_tags)", () => {
    const { supabase, channels } = supabaseStub();
    const unsub = startRealtimeTenantSync({
      supabase,
      tenantId: TENANT,
      onChange: () => {},
    });

    expect(channels).toHaveLength(3);
    const tables = channels.map((c) => c.config?.table).sort();
    expect(tables).toEqual(["appointments", "client_tags", "clients"]);

    // Every subscription is server-side filtered to the ACTIVE tenant only.
    for (const c of channels) {
      expect(c.config?.filter).toBe(`tenant_id=eq.${TENANT}`);
      expect(c.config?.event).toBe("*");
      expect(c.config?.schema).toBe("public");
      expect(c.name).toContain(`tenant:${TENANT}:`);
    }

    unsub();
  });

  test("a change event maps client_tags → 'tags' cache vocab", () => {
    const { supabase, channels } = supabaseStub();
    const seen: string[] = [];
    const unsub = startRealtimeTenantSync({
      supabase,
      tenantId: TENANT,
      onChange: (t) => seen.push(t),
    });

    for (const c of channels) c.onChange?.();
    expect(seen.sort()).toEqual(["appointments", "clients", "tags"]);

    unsub();
  });

  test("CLOSED then SUBSCRIBED fires onResync exactly once; steady-state SUBSCRIBED does not", () => {
    const { supabase, channels } = supabaseStub();
    const resynced: string[] = [];
    const unsub = startRealtimeTenantSync({
      supabase,
      tenantId: TENANT,
      onChange: () => {},
      onResync: (t) => resynced.push(t),
    });

    const clients = channels.find((c) => c.config?.table === "clients")!;

    // Initial SUBSCRIBED (never disconnected) → no resync.
    clients.emitStatus("SUBSCRIBED");
    expect(resynced).toEqual([]);

    // Drop then re-subscribe → exactly one resync for that table.
    clients.emitStatus("CLOSED");
    clients.emitStatus("SUBSCRIBED");
    expect(resynced).toEqual(["clients"]);

    // A subsequent steady-state SUBSCRIBED must NOT resync again (flag reset).
    clients.emitStatus("SUBSCRIBED");
    expect(resynced).toEqual(["clients"]);

    // CHANNEL_ERROR also counts as a disconnect for the next SUBSCRIBED.
    clients.emitStatus("CHANNEL_ERROR");
    clients.emitStatus("SUBSCRIBED");
    expect(resynced).toEqual(["clients", "clients"]);

    unsub();
  });

  test("unsubscribe removes every channel", () => {
    const { supabase, channels, removed } = supabaseStub();
    const unsub = startRealtimeTenantSync({
      supabase,
      tenantId: TENANT,
      onChange: () => {},
    });

    unsub();
    expect(removed).toHaveLength(3);
    // Exactly the channels we opened, no more, no fewer.
    expect(new Set(removed)).toEqual(new Set(channels));
  });

  test("null tenant no-ops: opens no channels, unsub is safe", () => {
    const { supabase, channels } = supabaseStub();
    const unsub = startRealtimeTenantSync({
      supabase,
      tenantId: null,
      onChange: () => {
        throw new Error("onChange must not fire for a null tenant");
      },
    });

    expect(channels).toHaveLength(0);
    expect(() => unsub()).not.toThrow();
  });
});
