import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Appointment } from "@babun/shared/local/appointments";
import { lastVisitTarget, serviceIdsOf } from "./repeat-visit";

// Строка «Как в прошлый раз» обещает именно прошлый раз. Ошибка здесь
// подставит чужую услугу или чужой адрес — команда уедет не туда и не с тем.

const TODAY = "2026-08-07";
/** Живой справочник услуг. Всё, чего здесь нет, считается снесённым. */
const LIVE = new Set([
  "s1", "s-old", "s-new", "s-ok", "s-утро", "s-вечер", "legacy", "fresh",
]);

function apt(over: Partial<Appointment>): Appointment {
  return {
    id: "a1",
    date: "2026-07-01",
    time_start: "10:00",
    time_end: "11:00",
    status: "completed",
    kind: "work",
    services: [],
    service_ids: [],
    ...over,
  } as Appointment;
}

const withService = (over: Partial<Appointment>) =>
  apt({ service_ids: ["s1"], ...over });

describe("повторить как в прошлый раз", () => {
  test("берётся самый свежий состоявшийся визит", () => {
    const target = lastVisitTarget(
      [
        withService({ id: "old", date: "2026-05-01", service_ids: ["s-old"] }),
        withService({ id: "new", date: "2026-06-20", service_ids: ["s-new"] }),
      ],
      TODAY,
      LIVE,
    );
    assert.deepEqual(target?.serviceIds, ["s-new"]);
    assert.equal(target?.date, "2026-06-20");
  });

  test("отменённый визит не считается прошлым разом", () => {
    const target = lastVisitTarget(
      [
        withService({ date: "2026-06-20", status: "cancelled" }),
        withService({ id: "ok", date: "2026-05-01", service_ids: ["s-ok"] }),
      ],
      TODAY,
      LIVE,
    );
    assert.deepEqual(target?.serviceIds, ["s-ok"]);
  });

  test("будущая запись не повторяется — она уже стоит", () => {
    const target = lastVisitTarget(
      [withService({ date: "2026-09-01" })],
      TODAY,
      LIVE,
    );
    assert.equal(target, null);
  });

  test("при двух визитах в один день берётся ПОЗДНИЙ", () => {
    const target = lastVisitTarget(
      [
        withService({ id: "утро", date: "2026-06-20", time_start: "10:00", service_ids: ["s-утро"] }),
        withService({ id: "вечер", date: "2026-06-20", time_start: "18:00", service_ids: ["s-вечер"] }),
      ],
      TODAY,
      LIVE,
    );
    assert.deepEqual(target?.serviceIds, ["s-вечер"]);
  });

  test("незакрытая прошедшая запись — не «прошлый раз»", () => {
    // Дата прошла, а статус «запланирована»: работа не подтверждена.
    const target = lastVisitTarget(
      [
        withService({ id: "висит", date: "2026-08-01", status: "scheduled" }),
        withService({ id: "закрыт", date: "2026-06-01", service_ids: ["s-ok"] }),
      ],
      TODAY,
      LIVE,
    );
    assert.deepEqual(target?.serviceIds, ["s-ok"]);
  });

  // УДАЛЁННАЯ УСЛУГА. Запись хранит id и цену, но не название: справочник —
  // единственный источник имени. Живая прод-запись Яниса (27 мая) ссылается
  // на снесённый «svc-mp8pt6pf-u2gh4» — строка показывалась пустой и несла
  // мёртвый id в форму записи.
  test("снесённая услуга не повторяется", () => {
    const target = lastVisitTarget(
      [withService({ date: "2026-06-20", service_ids: ["svc-удалён"] })],
      TODAY,
      LIVE,
    );
    assert.equal(target, null);
  });

  test("из двух услуг остаётся только живая", () => {
    const target = lastVisitTarget(
      [withService({ date: "2026-06-20", service_ids: ["svc-удалён", "s1"] })],
      TODAY,
      LIVE,
    );
    assert.deepEqual(target?.serviceIds, ["s1"]);
  });

  test("свежий визит со снесённой услугой не закрывает повторимый прошлый", () => {
    const target = lastVisitTarget(
      [
        withService({ date: "2026-07-30", service_ids: ["svc-удалён"] }),
        withService({ date: "2026-06-01", service_ids: ["s-ok"] }),
      ],
      TODAY,
      LIVE,
    );
    assert.deepEqual(target?.serviceIds, ["s-ok"]);
    assert.equal(target?.date, "2026-06-01");
  });

  test("справочник ещё не загружен — повторять нечего", () => {
    const target = lastVisitTarget(
      [withService({ date: "2026-06-20" })],
      TODAY,
      new Set(),
    );
    assert.equal(target, null);
  });

  test("визит без услуг нечего повторять", () => {
    assert.equal(lastVisitTarget([apt({})], TODAY, LIVE), null);
  });

  test("личное событие в календаре — не визит клиента", () => {
    const target = lastVisitTarget(
      [withService({ kind: "event" }), withService({ kind: "personal" })],
      TODAY,
      LIVE,
    );
    assert.equal(target, null);
  });

  test("объект и команда переезжают в заготовку", () => {
    const target = lastVisitTarget(
      [withService({ location_id: "loc-2", team_id: "team-9" })],
      TODAY,
      LIVE,
    );
    assert.equal(target?.locationId, "loc-2");
    assert.equal(target?.teamId, "team-9");
  });

  test("новый массив services выигрывает у легаси service_ids", () => {
    const ids = serviceIdsOf(
      apt({
        service_ids: ["legacy"],
        services: [
          {
            serviceId: "fresh",
            quantity: 1,
            pricePerUnit: 10,
            originalPrice: 10,
            totalPrice: 10,
            duration: 30,
          },
        ],
      }),
    );
    assert.deepEqual(ids, ["fresh"]);
  });
});
