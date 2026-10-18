import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Appointment } from "@babun/shared/local/appointments";
import { newestFirst, serviceNamesOf } from "./card-history";

const apt = (id: string, date: string, time_start: string, service_ids: string[] = []) =>
  ({ id, date, time_start, service_ids }) as unknown as Appointment;

describe("newestFirst", () => {
  test("orders by date, then by start time, newest on top", () => {
    const list = [apt("a", "2026-10-01", "09:00"), apt("b", "2026-10-02", "08:00"), apt("c", "2026-10-01", "14:30")];
    assert.deepEqual(newestFirst(list).map((x) => x.id), ["b", "c", "a"]);
  });

  test("does not reorder the input", () => {
    const list = [apt("a", "2026-01-01", "09:00"), apt("b", "2026-02-01", "09:00")];
    newestFirst(list);
    assert.deepEqual(list.map((x) => x.id), ["a", "b"]);
  });
});

describe("serviceNamesOf", () => {
  test("keeps catalog order of the appointment and drops unknown services", () => {
    const byId = new Map([["s1", "Чистка"], ["s2", "Заправка"]]);
    assert.deepEqual(serviceNamesOf(apt("a", "", "", ["s2", "gone", "s1"]), byId), ["Заправка", "Чистка"]);
  });
});
