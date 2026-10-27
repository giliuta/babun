import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  appointmentSituation,
  autoBaseColor,
  recordFilled,
  recordFilledFor,
  resolveRecordColor,
  fullyPaid,
  partlyPaid,
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
  test("выбранный рукой цвет сильнее «нет объекта» и обычного цвета", () => {
    assert.equal(
      resolveRecordColor({
        override: "#AF52DE",
        filled: { ...FULL, object: false },
        base: "#34C759",
        palette: PALETTE,
        fallback: COBALT,
      }),
      "#AF52DE",
    );
  });

  test("долг сильнее руки: перекрашенная запись не прячет долг", () => {
    assert.equal(
      resolveRecordColor({ override: "#AF52DE", filled: EMPTY, palette: PALETTE, fallback: COBALT }),
      PALETTE.unpaid,
    );
  });

  test("оплаченная запись — в цвете «Оплачено», сильнее руки и «нет объекта»", () => {
    assert.equal(
      resolveRecordColor({
        override: "#AF52DE",
        paid: "#19C321",
        filled: { ...FULL, object: false },
        palette: PALETTE,
        fallback: COBALT,
      }),
      "#19C321",
    );
  });

  test("предоплата красит запись до визита, после визита сильнее долг", () => {
    const before = resolveRecordColor({ prepaid: "#00BBDD", filled: FULL, palette: PALETTE, fallback: COBALT });
    assert.equal(before, "#00BBDD");
    const after = resolveRecordColor({ prepaid: "#00BBDD", filled: EMPTY, palette: PALETTE, fallback: COBALT });
    assert.equal(after, PALETTE.unpaid);
  });

  test("выключенный долг не красит — запись в обычном цвете", () => {
    assert.equal(
      resolveRecordColor({
        filled: { ...FULL, paid: false },
        base: "#34C759",
        palette: { ...PALETTE, unpaid: null },
        fallback: COBALT,
      }),
      "#34C759",
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

  test("сегодняшняя запись — долг, как только кончилось её время", () => {
    const today = {
      total_amount: 100,
      payment_status: "unpaid",
      prepaid_amount: 0,
      date: "2026-10-16",
      time_start: "10:00",
      time_end: "12:30",
    };
    // Идёт ещё — не долг.
    assert.equal(recordFilled(today, "2026-10-16", 12 * 60).paid, true);
    // Время вышло — долг, не дожидаясь завтра.
    assert.equal(recordFilled(today, "2026-10-16", 12 * 60 + 30).paid, false);
    assert.equal(recordFilled(today, "2026-10-16", 14 * 60 + 13).paid, false);
    // Без часов про сегодня не знаем — как раньше, только по дню.
    assert.equal(recordFilled(today, "2026-10-16").paid, true);
    // Нулевая запись кончается не раньше 15 минут от начала.
    const zero = { ...today, time_end: "10:00" };
    assert.equal(recordFilled(zero, "2026-10-16", 10 * 60 + 10).paid, true);
    assert.equal(recordFilled(zero, "2026-10-16", 10 * 60 + 15).paid, false);
  });
});

describe("resolveRecordSituation", () => {
  test("называет ту же дыру, что покрасила запись", () => {
    assert.equal(
      resolveRecordSituation({ filled: { ...FULL, object: false }, palette: PALETTE }),
      "noObject",
    );
  });

  test("рука прячет «нет объекта», но не долг", () => {
    assert.equal(
      resolveRecordSituation({ override: "#AF52DE", filled: { ...FULL, object: false }, palette: PALETTE }),
      null,
    );
    assert.equal(
      resolveRecordSituation({ override: "#AF52DE", filled: EMPTY, palette: PALETTE }),
      "unpaid",
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

describe("оплата, которую смотрящий не видит", () => {
  // Партнёр с «Суммой», но без «Оплаты»: сервер шлёт итог и нули оплаты.
  const past = {
    kind: "work",
    status: "scheduled",
    date: "2026-10-01",
    client_id: "c1",
    location_id: "l1",
    service_ids: ["s1"],
    total_amount: 100,
    payment_status: "unpaid",
    prepaid_amount: 0,
    paid_amount: 0,
  };

  test("видит оплату — прошедший неоплаченный визит горит «нет оплаты»", () => {
    assert.equal(recordFilled(past, "2026-10-03").paid, false);
    assert.equal(
      appointmentSituation(past, { palette: PALETTE, todayYmd: "2026-10-03" }),
      "unpaid",
    );
  });

  test("не видит — про оплату сказать нечего, дыры нет", () => {
    assert.equal(recordFilledFor(past, "2026-10-03", true).paid, true);
    assert.equal(
      appointmentSituation(past, { palette: PALETTE, todayYmd: "2026-10-03", paymentHidden: true }),
      null,
    );
  });
});

describe("fullyPaid", () => {
  const work = { kind: "work", status: "scheduled", total_amount: 100, payments: [] as { amount: number }[] };
  test("оплачено всё — оплачена, каким бы способом ни платили", () => {
    assert.equal(fullyPaid({ ...work, payments: [{ amount: 30 }, { amount: 70 }] }), true);
  });
  test("оплачено не всё — это долг, а не оплата", () => {
    assert.equal(fullyPaid({ ...work, payments: [{ amount: 60 }] }), false);
  });
  test("отмена, событие и запись без суммы — не оплата", () => {
    const paid = { ...work, payments: [{ amount: 100 }] };
    assert.equal(fullyPaid({ ...paid, status: "cancelled" }), false);
    assert.equal(fullyPaid({ ...paid, kind: "event" }), false);
    assert.equal(fullyPaid({ ...work, total_amount: 0 }), false);
  });
});

describe("partlyPaid", () => {
  const work = { kind: "work", status: "scheduled", total_amount: 100, payments: [] as { amount: number }[] };
  test("аванс меньше суммы — предоплата", () => {
    assert.equal(partlyPaid({ ...work, prepaid_amount: 30 }), true);
    assert.equal(partlyPaid({ ...work, payments: [{ amount: 40 }] }), true);
  });
  test("ничего не внесено или внесено всё — не предоплата", () => {
    assert.equal(partlyPaid(work), false);
    assert.equal(partlyPaid({ ...work, payments: [{ amount: 100 }] }), false);
  });
  test("отмена — не предоплата", () => {
    assert.equal(partlyPaid({ ...work, status: "cancelled", prepaid_amount: 30 }), false);
  });
});

describe("деньги — до цента", () => {
  const work = { kind: "work", status: "scheduled", total_amount: 11.9, prepaid_amount: 4.76 };
  test("аванс и платёж, которые во float не сходятся, — всё равно оплачено", () => {
    const apt = { ...work, payments: [{ amount: 7.14 }] };
    assert.equal(fullyPaid(apt), true);
    assert.equal(partlyPaid(apt), false);
    assert.equal(recordFilled({ ...apt, date: "2026-10-01" }, "2026-10-27").paid, true);
  });
});

describe("предоплата — только пока визит впереди", () => {
  test("после визита с выключенным «Долгом» часть оплаты не красится предоплатой", () => {
    assert.equal(
      resolveRecordColor({
        prepaid: "#22B8CF",
        filled: { ...FULL, paid: false },
        base: "#34C759",
        palette: { ...PALETTE, unpaid: null },
        fallback: COBALT,
      }),
      "#34C759",
    );
  });
  test("до визита внесённая часть — предоплата", () => {
    assert.equal(
      resolveRecordColor({ prepaid: "#22B8CF", filled: FULL, base: "#34C759", palette: PALETTE, fallback: COBALT }),
      "#22B8CF",
    );
  });
});
