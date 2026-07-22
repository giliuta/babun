import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  dispatcherServiceJsonToService,
  masterClientJsonToClient,
  masterServiceJsonToService,
  operationalMasterJsonToMaster,
  operationalTeamJsonToTeam,
} from "./master-reference";

describe("master reference projections", () => {
  test("keeps only the operational client identity", () => {
    const client = masterClientJsonToClient({
      id: "client-1",
      tenant_id: "tenant-1",
      full_name: "Иван Петров",
      phone: "+35799111222",
      created_at: "2026-07-20T00:00:00Z",
      balance: -500,
      discount: 40,
      birthday: "1980-01-01",
      blacklisted: true,
      comment: "internal",
      notes: [{ text: "private" }],
      email: "private@example.com",
    });

    assert.equal(client.full_name, "Иван Петров");
    assert.equal(client.phone, "+35799111222");
    assert.equal(client.balance, 0);
    assert.equal(client.discount, 0);
    assert.equal(client.birthday, "");
    assert.equal(client.blacklisted, false);
    assert.equal(client.comment, "");
    assert.equal(client.email, "");
    assert.deepEqual(client.notes, []);
    assert.deepEqual(client.tag_ids, []);
  });

  test("keeps a service label but zeros all economics", () => {
    const service = masterServiceJsonToService({
      id: "service-1",
      tenant_id: "tenant-1",
      name: "Чистка кондиционера",
      color: "#0A84FF",
      price: 250,
      cost_per_unit: 90,
      material_costs: [{ name: "Химия", amount: 40 }],
      price_tiers: [{ min_qty: 3, price_per_unit: 200 }],
    });

    assert.equal(service.name, "Чистка кондиционера");
    assert.equal(service.color, "#0A84FF");
    assert.equal(service.price, 0);
    assert.equal(service.cost_per_unit, 0);
    assert.deepEqual(service.material_costs, []);
    assert.equal(service.price_tiers, null);
  });

  test("keeps dispatcher sale pricing but strips service cost economics", () => {
    const service = dispatcherServiceJsonToService({
      id: "service-1",
      tenant_id: "tenant-1",
      category_id: "category-1",
      name: "Чистка",
      price: 80,
      duration_minutes: 60,
      color: "#0A84FF",
      is_countable: true,
      price_tiers: [{ min_qty: 3, price_per_unit: 70 }],
      duration_tiers: [{ min_qty: 3, duration_minutes: 45 }],
      bulk_threshold: 3,
      bulk_price: 70,
      brigade_ids: ["team-1"],
      is_active: true,
      position: 1,
      created_at: "2026-07-20T00:00:00Z",
      updated_at: "2026-07-20T00:00:00Z",
      cost_per_unit: 45,
      material_costs: [{ name: "private", amount: 20 }],
    });

    assert.equal(service.price, 80);
    assert.equal(service.bulk_price, 70);
    assert.deepEqual(service.brigade_ids, ["team-1"]);
    assert.equal(service.cost_per_unit, 0);
    assert.deepEqual(service.material_costs, []);
  });

  test("keeps calendar fields but strips team payout and roster blobs", () => {
    const team = operationalTeamJsonToTeam({
      id: "team-1",
      tenant_id: "tenant-1",
      name: "Монтаж",
      region: "Лимасол",
      color: "#0A84FF",
      is_active: true,
      position: 1,
      timezone: "Asia/Nicosia",
      default_city: "Лимасол",
      cities: ["Лимасол"],
      tint_days_by_label: true,
      hide_cancelled: false,
      allow_overtime: false,
      appointment_blocks: [],
      buffer_minutes: 15,
      calendar_window_start: "08:00",
      calendar_window_end: "20:00",
      default_scroll_time: "08:00",
      default_slot_minutes: 60,
      created_at: "2026-07-20T00:00:00Z",
      updated_at: "2026-07-20T00:00:00Z",
      payout_percentage: 45,
      members: [{ master_id: "private" }],
      roles: [{ name: "private" }],
      lead_ids: ["private"],
    });

    assert.equal(team.name, "Монтаж");
    assert.equal(team.timezone, "Asia/Nicosia");
    assert.equal(team.payout_percentage, 0);
    assert.deepEqual(team.members, []);
    assert.deepEqual(team.roles, []);
    assert.deepEqual(team.lead_ids, []);
  });

  test("keeps a booking identity but discards employee profile PII", () => {
    const master = operationalMasterJsonToMaster({
      id: "master-1",
      tenant_id: "tenant-1",
      full_name: "Иван Петров",
      phone: "+35799111222",
      avatar_url: null,
      team_id: "team-1",
      role: "lead",
      title: "Бригадир",
      color: "#0A84FF",
      account_status: "active",
      is_active: true,
      position: 1,
      created_at: "2026-07-20T00:00:00Z",
      updated_at: "2026-07-20T00:00:00Z",
      profile: { iban: "CY00PRIVATE", salary: 5000 },
      created_by: "private-user-id",
    });

    assert.equal(master.full_name, "Иван Петров");
    assert.equal(master.phone, "+35799111222");
    assert.deepEqual(master.profile, {});
    assert.equal(master.created_by, null);
  });
});
