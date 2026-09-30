import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  autoBaseColor,
  recordFilled,
  resolveRecordColor,
  resolveRecordSituation,
  serviceBaseColor,
} from "./record-color";

const FULL = { client: true, object: true, services: true, paid: true };
const PALETTE = {
  unpaid: "#E8145D",
  noObject: "#FF9500",
};
const COBALT = "#2F6BFF";
const EMPTY = { client: true, object: false, services: true, paid: false };

describe("resolveRecordColor", () => {
  test("выбранный рукой цвет сильнее всех правил", () => {
    assert.equal(
      resolveRecordColor({
        override: "#AF52DE",
        filled: EMPTY,
        base: "#34C759",
        palette: PALETTE,
        fallback: COBALT,
      }),
      "#AF52DE",
    );
  });

  test("заполненная запись берёт обычный цвет", () => {
    assert.equal(
      resolveRecordColor({ filled: FULL, base: "#34C759", palette: PALETTE, fallback: COBALT }),
      "#34C759",
    );
  });

  test("долг важнее пустого объекта", () => {
    assert.equal(
      resolveRecordColor({ filled: EMPTY, base: "#34C759", palette: PALETTE, fallback: COBALT }),
      PALETTE.unpaid,
    );
    assert.equal(
      resolveRecordColor({
        filled: { ...FULL, object: false },
        base: "#34C759",
        palette: PALETTE,
        fallback: COBALT,
      }),
      PALETTE.noObject,
    );
  });

  test("ситуация без своего цвета пропускается, а не гасит остальные", () => {
    assert.equal(
      resolveRecordColor({
        filled: EMPTY,
        base: "#34C759",
        palette: { unpaid: null, noObject: "#FF9500" },
        fallback: COBALT,
      }),
      "#FF9500",
    );
  });

  test("выключенный блок не считается дырой — запись «всё заполнено»", () => {
    // Выключены «Объект» и «Оплата» — подсветки нет, цвет обычный.
    assert.equal(
      resolveRecordColor({
        filled: EMPTY,
        base: "#34C759",
        palette: PALETTE,
        active: [],
        fallback: COBALT,
      }),
      "#34C759",
    );
  });

  test("нет ни правила, ни обычного цвета — кобальт продукта", () => {
    assert.equal(
      resolveRecordColor({ filled: FULL, base: null, palette: {}, fallback: COBALT }),
      COBALT,
    );
  });
});

describe("recordFilled", () => {
  test("объект закрыт вписанным адресом, не только ссылкой", () => {
    assert.equal(recordFilled({ location_id: "loc-1" }).object, true);
    assert.equal(recordFilled({ address: "Лимассол, 1" }).object, true);
    assert.equal(recordFilled({ address: "  " }).object, false);
    assert.equal(recordFilled({}).object, false);
  });

  test("«не оплачено» — только после визита и при долге", () => {
    const base = { total_amount: 100, payment_status: "unpaid", prepaid_amount: 0 };
    // Будущая запись долгом не считается.
    assert.equal(recordFilled({ ...base, date: "2026-10-01" }, "2026-09-25").paid, true);
    // День прошёл — долг.
    assert.equal(recordFilled({ ...base, date: "2026-09-20" }, "2026-09-25").paid, false);
    // Выполнена сегодня — долг.
    assert.equal(recordFilled({ ...base, date: "2026-09-25", status: "completed" }, "2026-09-25").paid, false);
    // Оплачено полностью (леджер) — не долг.
    assert.equal(
      recordFilled({ ...base, date: "2026-09-20", payments: [{ amount: 100 }] }, "2026-09-25").paid,
      true,
    );
    // Аванс покрыл сумму — не долг.
    assert.equal(recordFilled({ ...base, date: "2026-09-20", prepaid_amount: 100 }, "2026-09-25").paid, true);
    // Бесплатный визит — не долг.
    assert.equal(recordFilled({ total_amount: 0, date: "2026-09-20" }, "2026-09-25").paid, true);
  });
});

describe("resolveRecordSituation", () => {
  test("называет ту же дыру, что покрасила запись", () => {
    assert.equal(
      resolveRecordSituation({ filled: { ...FULL, object: false }, palette: PALETTE }),
      "noObject",
    );
  });

  test("у записи с выбранным рукой цветом ситуации нет", () => {
    assert.equal(
      resolveRecordSituation({ override: "#AF52DE", filled: EMPTY, palette: PALETTE }),
      null,
    );
  });
});

describe("serviceBaseColor", () => {
  const colorOf = (map: Record<string, string>) => (id: string) => map[id];

  test("первая услуга выигрывает у второй", () => {
    // Порядок услуг — порядок нажатий, и он же порядок, в котором услуги
    // напечатаны на блоке: «почему запись зелёная» видно, не открывая её.
    assert.equal(
      serviceBaseColor(
        { service_ids: ["a", "b"] },
        colorOf({ a: "#34C759", b: "#FF9500" }),
      ),
      "#34C759",
    );
  });

  test("строка без цвета пропускается к следующей", () => {
    // Стёртая насовсем услуга живёт в снимке именем, а цвета у неё нет:
    // падать из-за неё в цвет команды значило бы «правило не работает».
    assert.equal(
      serviceBaseColor({ service_ids: ["a", "b"] }, colorOf({ b: "#FF9500" })),
      "#FF9500",
    );
    assert.equal(
      serviceBaseColor({ service_ids: ["a"] }, colorOf({ a: "   " })),
      null,
    );
  });

  test("пустой список даёт null — упадём в цвет команды", () => {
    assert.equal(serviceBaseColor({ service_ids: [] }, colorOf({})), null);
    assert.equal(serviceBaseColor({}, colorOf({})), null);
  });

  test("снимок читается, только когда service_ids пуст", () => {
    // Бригадная проекция отдаёт `services: []` при заполненном `service_ids` —
    // снимок первым источником молча гасил бы цвет в наряде мастера.
    const colors = colorOf({ a: "#34C759", b: "#FF9500" });
    assert.equal(
      serviceBaseColor(
        { service_ids: ["a"], services: [{ serviceId: "b" }] },
        colors,
      ),
      "#34C759",
    );
    assert.equal(
      serviceBaseColor(
        { service_ids: [], services: [{ serviceId: "b" }] },
        colors,
      ),
      "#FF9500",
    );
  });
});

describe("autoBaseColor — обычный цвет по настройке, один для сетки и формы", () => {
  const colors = { team: "#3276FB", label: "#15A84F", service: "#FDAA1B" };
  test("правило выбирает свой источник", () => {
    assert.equal(autoBaseColor("team", colors), "#3276FB");
    assert.equal(autoBaseColor("label", colors), "#15A84F");
    assert.equal(autoBaseColor("service", colors), "#FDAA1B");
  });
  test("нет своего цвета — цвет команды", () => {
    assert.equal(autoBaseColor("label", { team: "#3276FB", label: null }), "#3276FB");
    assert.equal(autoBaseColor("service", { team: "#3276FB", service: "  " }), "#3276FB");
  });
  test("нет ничего — null, решает запасной цвет у вызывающего", () => {
    assert.equal(autoBaseColor("label", {}), null);
  });
});
