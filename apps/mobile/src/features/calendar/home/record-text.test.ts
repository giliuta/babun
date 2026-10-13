import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  createBlankAppointment,
  type AppointmentService,
} from "@babun/shared/local/appointments";
import { serviceSummary } from "./record-text";

const catalog = new Map([
  ["s1", "Чистка"],
  ["s2", "Диагностика"],
]);
const line = (serviceId: string, quantity: number, serviceName?: string): AppointmentService => ({
  serviceId,
  quantity,
  pricePerUnit: 10,
  originalPrice: 10,
  totalPrice: 10 * quantity,
  duration: 60 * quantity,
  serviceName,
});

describe("serviceSummary", () => {
  test("the snapshot name wins over the catalog, quantity becomes «xN»", () => {
    const a = createBlankAppointment({
      services: [line("s1", 1, "Чистка (старое имя)"), line("s2", 2)],
      service_ids: ["s1", "s2", "s2"],
    });
    assert.equal(serviceSummary(a, catalog), "Чистка (старое имя), x2 Диагностика");
  });

  test("a deleted service with no snapshot name reads «Услуга удалена»", () => {
    const a = createBlankAppointment({ services: [line("gone", 1, "  ")] });
    assert.equal(serviceSummary(a, catalog), "Услуга удалена");
  });

  test("without a snapshot the ids are counted against the catalog", () => {
    const a = createBlankAppointment({ services: [], service_ids: ["s2", "s1", "s2", "gone"] });
    assert.equal(serviceSummary(a, catalog), "x2 Диагностика, Чистка, Услуга удалена");
  });

  test("no services — empty string", () => {
    assert.equal(serviceSummary(createBlankAppointment({ services: [], service_ids: [] }), catalog), "");
  });
});
