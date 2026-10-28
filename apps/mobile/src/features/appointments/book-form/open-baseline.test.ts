import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Appointment } from "@babun/shared/local/appointments";
import type { Client } from "@babun/shared/local/clients";
import type { Service } from "@/features/services/queries";
import { withBaselineStatus } from "@/features/appointments/edit-baseline";
import { openRecordPatch, sameAsOpen, type OpenRecord, type OpenRefs } from "./open-baseline";

// №17 ВЛАДЕЛЬЦА: ЛЮБАЯ ОТКРЫТАЯ ЗАПИСЬ СРАЗУ «ИЗМЕНЕНА». Эталон снимался в
// кадр загрузки, а каталог, клиент и ставка VAT доезжали позже и двигали
// патч формы. Здесь — три записи из письма владельца: своя метка не как у
// дня (Katia), своя метка при дне без метки (Никита), без метки и прошедшая
// (Валентина).

const service = { id: "s1", name: "Чистка", price: 60, duration_minutes: 60, buffer_before_min: 0, buffer_after_min: 15 } as unknown as Service;

/** Запись в состоянии формы — так её кладёт гидрация (`use-book-draft.ts`). */
function openFrom(apt: Partial<Appointment> & Pick<Appointment, "date" | "time_start" | "time_end">): OpenRecord {
  const services = apt.services ?? [];
  return {
    kind: "work",
    teamId: apt.team_id ?? "t1",
    clientId: apt.client_id ?? null,
    locationId: apt.location_id ?? null,
    address: apt.address ?? "",
    date: apt.date,
    timeStart: apt.time_start,
    timeEnd: apt.time_end,
    durationTouched: true,
    durationByHand: false,
    serviceIds: apt.service_ids ?? services.map((s) => s.serviceId),
    overrides: Object.fromEntries(
      services.map((s) => [
        s.serviceId,
        {
          qty: s.quantity,
          locked: {
            pricePerUnit: s.pricePerUnit,
            originalPrice: s.originalPrice,
            duration: s.duration,
            serviceName: s.serviceName,
            unit: s.unit,
          },
        },
      ]),
    ),
    masterId: null,
    customTotal: !!apt.custom_total,
    totalDraft: String(apt.total_amount ?? 0),
    discountType: null,
    discountValue: "",
    discountReason: null,
    recordVatMode: apt.vat_mode === "inclusive" || apt.vat_mode === "exclusive" ? apt.vat_mode : "none",
    recordVatRate: apt.vat_rate ?? null,
    status: apt.status ?? "scheduled",
    comment: apt.comment ?? "",
    eventTitle: "",
    eventColor: null,
    eventTypeId: null,
    eventNotes: "",
    eventAddress: "",
    eventUrl: "",
    eventReminderOffset: null,
    repeat: { kind: "none" },
    allDay: false,
    reminderOn: apt.reminder_enabled ?? true,
    colorOverride: null,
    city: apt.city ?? null,
    cityTouched: false,
  };
}

const line = { serviceId: "s1", serviceName: "Чистка", quantity: 1, pricePerUnit: 60, originalPrice: 60, duration: 60, totalPrice: 60 };
const records = {
  katia: openFrom({ client_id: "c1", date: "2026-10-31", time_start: "10:00", time_end: "11:15", city: "Paphos", services: [line] as Appointment["services"], total_amount: 60 }),
  nikita: openFrom({ client_id: "c2", date: "2026-10-30", time_start: "12:00", time_end: "13:15", city: "Paphos", services: [line] as Appointment["services"], total_amount: 60, vat_mode: "inclusive" }),
  valentina: openFrom({ client_id: "c3", date: "2026-10-22", time_start: "09:00", time_end: "10:00", city: null, services: [line] as Appointment["services"], total_amount: 60, status: "completed" }),
};

const client = (id: string) => ({ id, phone: "+35799000000" }) as unknown as Client;
/** Справочники в кадр загрузки записи — ещё ничего не доехало. */
const before = (_open: OpenRecord): OpenRefs => ({
  isEdit: true,
  catalog: new Map(),
  rememberedRate: 0,
  client: null,
  eventTypeLabel: null,
  eventLoc: null,
  clientLocations: [],
});
/** Доехали каталог (буфер 15 мин), клиент с телефоном, ставка команды 19 %. */
const after = (open: OpenRecord): OpenRefs => ({
  ...before(open),
  catalog: new Map([["s1", service]]),
  rememberedRate: 19,
  client: open.clientId ? client(open.clientId) : null,
});

const sig = (open: OpenRecord, refs: OpenRefs) => JSON.stringify(openRecordPatch(open, refs));

describe("открытая запись не «изменена», пока её не тронули (№17)", () => {
  for (const [name, open] of Object.entries(records)) {
    test(`${name}: справочники доехали — патч сдвинулся, но эталон на тех же справочниках равен форме`, () => {
      // Причина: эталон кадра загрузки разошёлся бы с формой.
      assert.notEqual(sig(open, before(open)), sig(open, after(open)));
      // Форма без единой правки — тот же вид записи на тех же справочниках.
      const form = { ...open };
      assert.equal(sig(form, after(open)), sig(open, after(open)));
    });
  }

  test("настоящая правка — по-прежнему изменение", () => {
    const open = records.katia;
    assert.notEqual(sig({ ...open, timeStart: "10:30" }, after(open)), sig(open, after(open)));
    assert.notEqual(sig({ ...open, city: "Limassol" }, after(open)), sig(open, after(open)));
  });

  test("статус, сменённый оплатой мимо «Сохранить», переносится на свежий эталон", () => {
    const open = records.nikita;
    const moved = withBaselineStatus(sig(open, after(open)), "completed");
    assert.equal(moved, sig({ ...open, status: "completed" }, after(open)));
  });

  test("прерванная правка, равная записи при открытии, не поднимается", () => {
    const { discountReason: _r, ...snap } = records.valentina;
    // Расчётный итог форма пересчитывает сама — это не ввод.
    assert.equal(sameAsOpen({ ...snap, totalDraft: "71.40" }, snap), true);
    assert.equal(sameAsOpen({ ...snap, comment: "позвонить" }, snap), false);
    // Своя сумма — ввод человека.
    const own = { ...snap, customTotal: true };
    assert.equal(sameAsOpen({ ...own, totalDraft: "80" }, own), false);
  });
});
