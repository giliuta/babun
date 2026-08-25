import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Client } from "@babun/shared/local/clients";
import {
  buildQuickClientDraft,
  findQuickClientDuplicate,
  resolveBookingClientPrefill,
  resolveBookingTeamId,
  type BookingClientRef,
} from "./booking-prefill";

function client(
  patch: Partial<Client> & Pick<Client, "id">,
): BookingClientRef {
  return {
    id: patch.id,
    locations: patch.locations ?? [],
    favorite_master_id: patch.favorite_master_id ?? null,
    phone: patch.phone ?? "",
    phone_e164: patch.phone_e164 ?? null,
    deleted_at: patch.deleted_at ?? null,
  };
}

describe("resolveBookingClientPrefill", () => {
  const item = client({
    id: "client-1",
    favorite_master_id: "master-1",
    locations: [
      {
        id: "home",
        label: "Дом",
        address: "  Лимассол, 1  ",
        note: "  код 42  ",
        isPrimary: true,
      },
      {
        id: "office",
        label: "Офис",
        address: "Никосия, 2",
        isPrimary: false,
      },
    ],
  });

  test("honours a live deep-linked object and copies its address snapshot", () => {
    assert.deepEqual(resolveBookingClientPrefill(item, "office"), {
      clientId: "client-1",
      locationId: "office",
      address: "Никосия, 2",
      addressNote: "",
      masterId: "master-1",
    });
  });

  test("falls back from a stale object to the primary object", () => {
    assert.deepEqual(resolveBookingClientPrefill(item, "deleted-location"), {
      clientId: "client-1",
      locationId: "home",
      address: "Лимассол, 1",
      addressNote: "код 42",
      masterId: "master-1",
    });
  });
});

describe("resolveBookingTeamId", () => {
  const teams = [{ id: "team-a" }, { id: "team-b" }];

  test("keeps a live requested team", () => {
    assert.equal(resolveBookingTeamId("team-b", teams, "team-a"), "team-b");
  });

  test("replaces a stale requested team with the last live team", () => {
    assert.equal(resolveBookingTeamId("archived", teams, "team-b"), "team-b");
  });

  test("falls back to the first team and returns null for an empty tenant", () => {
    assert.equal(resolveBookingTeamId(null, teams, null), "team-a");
    assert.equal(resolveBookingTeamId("archived", [], null), null);
  });
});

describe("quick client creation", () => {
  test("stores a text query only as the name", () => {
    assert.deepEqual(buildQuickClientDraft("  Иван Петров  "), {
      kind: "name",
      full_name: "Иван Петров",
      phone: "",
      phone_e164: null,
      canCreate: true,
    });
  });

  test("normalizes a valid Cyprus phone and rejects an incomplete phone", () => {
    const valid = buildQuickClientDraft("99 123 456");
    assert.equal(valid.kind, "phone");
    assert.equal(valid.phone_e164, "+35799123456");
    assert.equal(valid.canCreate, true);

    const incomplete = buildQuickClientDraft("+357 99");
    assert.equal(incomplete.kind, "phone");
    assert.equal(incomplete.phone_e164, null);
    assert.equal(incomplete.canCreate, false);
  });

  test("finds a live duplicate by canonical or legacy phone", () => {
    const canonical = client({
      id: "canonical",
      phone: "+357 99 000 000",
      phone_e164: "+35799000000",
    });
    const legacy = client({ id: "legacy", phone: "99 123 456" });
    const deleted = client({
      id: "deleted",
      phone: "99 123 456",
      deleted_at: "2026-07-20T00:00:00Z",
    });

    assert.equal(
      findQuickClientDuplicate([canonical, legacy], "+35799000000")?.id,
      "canonical",
    );
    assert.equal(
      findQuickClientDuplicate([deleted, legacy], "+35799123456")?.id,
      "legacy",
    );
  });
});
