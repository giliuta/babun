import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { Appointment } from "@babun/shared/local/appointments";
import type { Client } from "@babun/shared/local/clients";

import { maskHistoryRow, mirrorHistory, withClientHistory } from "./member-history";

const row = (id: string, patch: Partial<Appointment> = {}): Appointment =>
  ({
    id,
    client_id: "c1",
    kind: "work",
    date: "2026-09-01",
    time_start: "10:00",
    location_id: "loc-1",
    comment: "код 12",
    address: "Лимассол, ул. 1",
    address_note: "",
    address_lat: 1,
    address_lng: 2,
    city: "Лимассол",
    total_amount: 120,
    paid_amount: 120,
    discount_amount: 10,
    custom_total: true,
    payment_status: "paid",
    services: [{ serviceId: "s", quantity: 1, pricePerUnit: 120, originalPrice: 130, totalPrice: 120, duration: 60 }],
    ...patch,
  }) as unknown as Appointment;

const withBlocks = (blocks: Record<string, string>) => ({ blocks }) as unknown as Pick<Client, "blocks">;

describe("«История записей» сотрудника (01.10)", () => {
  test("история дополняет календарь; строка календаря без клиента уступает", () => {
    const calendar = [row("a", { client_id: null }), row("b"), row("x", { client_id: "c9" })];
    const history = [row("a"), row("b", { comment: "" }), row("c")];
    const merged = withClientHistory(calendar, history);
    assert.deepEqual(merged.map((r) => [r.id, r.client_id]), [["a", "c1"], ["b", "c1"], ["x", "c9"], ["c", "c1"]]);
    assert.equal(merged[1].comment, "код 12", "строка календаря с клиентом главнее");
    assert.deepEqual(withClientHistory(calendar, []), calendar);
  });

  test("без «Долг и деньги» — нулевые суммы и цены; без «Объекты» — без объекта; заметки — никогда", () => {
    const masked = maskHistoryRow(row("a"), withBlocks({ "clients.history": "read" }));
    assert.equal(masked.total_amount, 0);
    assert.equal(masked.paid_amount, 0);
    assert.equal(masked.payment_status, "unpaid");
    assert.equal(masked.services[0].totalPrice, 0);
    assert.equal(masked.location_id, null);
    assert.equal(masked.comment, "");
    assert.equal(masked.address, "");
    assert.equal(masked.city, null);
    const open = maskHistoryRow(row("a"), withBlocks({ "clients.money": "read", "clients.objects": "read" }));
    assert.equal(open.total_amount, 120);
    assert.equal(open.services[0].totalPrice, 120);
    assert.equal(open.location_id, "loc-1");
    assert.equal(open.comment, "", "заметка записи — право календаря");
  });

  test("«его глазами»: только клиенты набора с открытой историей и только работы", () => {
    const clients = new Map([
      ["c1", withBlocks({ "clients.history": "read" })],
      ["c2", withBlocks({ "clients.history": "off" })],
    ]);
    const all = [row("a"), row("b", { client_id: "c2" }), row("c", { client_id: "c3" }), row("d", { kind: "event" })];
    assert.deepEqual(mirrorHistory(all, clients).map((r) => r.id), ["a"]);
  });
});
