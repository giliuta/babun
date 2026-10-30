import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  calendarTariffState,
  canAddPartner,
  parseCalendarTariffs,
  partnerTariffAction,
  tierAllows,
  tierOf,
  trialLeft,
  tariffAction,
  tariffStatus,
  trialUsed,
  type TariffState,
} from "./tiers";

// ТАРИФ — У КАЛЕНДАРЯ: каждый календарь платит своей подпиской (€9,99 в
// месяц, €7,99 при оплате за год); «навсегда» и пробный — у аккаунта и
// открывают все его календари.

describe("действующий тариф", () => {
  test("сервер отдаёт tier — он и есть", () => {
    assert.equal(tierOf({ tier: "pro", plan: "free" }), "pro");
  });

  test("без tier — по старым полям", () => {
    assert.equal(tierOf({ plan: "free", plan_override: null }), "free");
    assert.equal(tierOf({ plan: "free", plan_override: "lifetime" }), "max");
    assert.equal(tierOf({ plan: "business" }), "max");
  });

  test("партнёр тарифа не видит — неизвестно, экран не режет", () => {
    assert.equal(tierOf({ plan: "" }), null);
    assert.equal(tierAllows(null, "clients"), true);
  });
});

describe("что открывает тариф", () => {
  test("без оплаты — ни клиентов, ни записей клиентов, ни партнёров", () => {
    assert.equal(tierAllows("free", "clients"), false);
    assert.equal(tierAllows("free", "book-clients"), false);
    assert.equal(tierAllows("free", "documents"), false);
    assert.equal(tierAllows("free", "partners"), false);
  });

  test("оплачено — всё; старый пробный Про — до 5 партнёров", () => {
    assert.equal(tierAllows("max", "partners"), true);
    assert.equal(canAddPartner("pro", 5), false);
    assert.equal(canAddPartner("max", 200), true);
    assert.equal(canAddPartner("free", 0), false);
  });
});

describe("пробный период", () => {
  const now = new Date("2026-10-01T12:00:00Z");

  test("идёт — тариф и сколько дней осталось", () => {
    const left = trialLeft({ trial_tier: "max", trial_ends_at: "2026-10-10T12:00:00Z" }, now);
    assert.deepEqual(left, { tier: "max", days: 9 });
  });

  test("кончился или не начинался — нет", () => {
    assert.equal(trialLeft({ trial_tier: "max", trial_ends_at: "2026-09-30T12:00:00Z" }, now), null);
    assert.equal(trialLeft({ trial_tier: null, trial_ends_at: null }, now), null);
  });

  test("второй раз не даётся", () => {
    assert.equal(trialUsed({ trial_started_at: "2026-09-01T00:00:00Z" }), true);
    assert.equal(trialUsed({ trial_started_at: null }), false);
  });
});

describe("тариф каждого календаря", () => {
  const answer = [
    { team_id: "a", plan: "max", status: "active", period: "year", current_period_end: "2026-11-27T08:30:50Z", cancel_at_period_end: false },
    { team_id: "b", plan: "free", status: null, period: null, current_period_end: null, cancel_at_period_end: null },
    // Партнёру сервер отдаёт только оплачен ли календарь.
    { team_id: "c", plan: "max" },
    // Мусор не становится «бесплатным календарём».
    { team_id: "d", plan: "gold" },
    { plan: "max" },
  ];

  test("разбор ответа calendar_tariffs", () => {
    const map = parseCalendarTariffs(answer);
    assert.deepEqual([...map.keys()], ["a", "b", "c"]);
    assert.deepEqual(map.get("a"), {
      teamId: "a",
      plan: "max",
      status: "active",
      period: "year",
      periodEnd: "2026-11-27T08:30:50Z",
      cancelAtPeriodEnd: false,
    });
    assert.equal(map.get("c")?.status, null);
    assert.equal(parseCalendarTariffs(null).size, 0);
  });

  const account = { forever: false, trial: null, trialUsed: true };

  test("подписка календаря — оплачен, с периодом и отменой", () => {
    const map = parseCalendarTariffs(answer);
    const paid = calendarTariffState(account, map.get("a"));
    assert.equal(paid.paid, true);
    assert.equal(paid.period, "year");
    assert.equal(paid.cancelling, false);
    const free = calendarTariffState(account, map.get("b"));
    assert.equal(free.paid, false);
    assert.equal(free.tier, "free");
    // Строки нет — тариф неизвестен, экран не режет.
    assert.equal(calendarTariffState(account, undefined).tier, null);
  });

  test("«навсегда» — от аккаунта: календарь не «оплачен», платить нечего", () => {
    const forever = calendarTariffState({ ...account, forever: true }, { teamId: "x", plan: "max", status: null, period: null, periodEnd: null, cancelAtPeriodEnd: false });
    assert.equal(forever.paid, false);
    assert.equal(tariffAction(forever), null);
    assert.equal(tariffStatus(forever), "Навсегда");
  });
});

describe("действие страницы тарифа календаря", () => {
  const fresh: TariffState = { tier: "free", paid: false, forever: false, trial: null, trialUsed: false };

  test("новый аккаунт — пробный 14 дней", () => {
    assert.deepEqual(tariffAction(fresh), { kind: "trial", label: "Попробовать 14 дней" });
    assert.equal(tariffStatus(fresh), "Не оплачен");
  });

  test("идёт пробный или он кончился — оплата одного календаря", () => {
    const trial = { ...fresh, tier: "max" as const, trial: { tier: "max" as const, days: 3 }, trialUsed: true };
    assert.deepEqual(tariffAction(trial), { kind: "pay", label: "Оплатить €9,99 в месяц" });
    assert.equal(tariffStatus(trial), "Пробный · ещё 3 дня");
    const over = { ...fresh, trialUsed: true };
    assert.equal(tariffAction(over)?.label, "Оплатить €9,99 в месяц");
    assert.equal(tariffStatus(over), "Не оплачен");
  });

  test("за год — цена года, и кнопка это говорит", () => {
    const over = { ...fresh, trialUsed: true };
    assert.deepEqual(tariffAction(over, "year"), { kind: "pay", label: "Оплатить €95,88 за год" });
    assert.equal(partnerTariffAction(fresh, "Giliuta", "year")?.label, "Оплатить €95,88 за год за Giliuta");
  });

  test("оплаченный — без кнопки; другой период — переход на него", () => {
    const paid = { ...fresh, tier: "max" as const, paid: true, trialUsed: true, period: "month" as const };
    assert.equal(tariffAction(paid, "month"), null);
    assert.deepEqual(tariffAction(paid, "year"), { kind: "change", label: "Платить за год — €95,88" });
    assert.deepEqual(tariffAction({ ...paid, period: "year" }, "month"), {
      kind: "change",
      label: "Платить помесячно — €9,99",
    });
    assert.match(tariffStatus(paid, "2026-11-03T00:00:00Z"), /^Оплачен до 03\.11$/);
  });

  test("отменённая подписка — работает до конца срока", () => {
    const cancelling = { ...fresh, tier: "max" as const, paid: true, trialUsed: true, period: "month" as const, cancelling: true };
    assert.equal(tariffStatus(cancelling, "2026-11-03T00:00:00Z"), "Отменён · работает до 03.11");
  });

  test("продление не списалось — «Оплата не прошла», а не «Оплачен до …»", () => {
    const paid = { ...fresh, tier: "max" as const, paid: true, trialUsed: true };
    assert.equal(tariffStatus({ ...paid, pastDue: true }, "2026-11-03T00:00:00Z"), "Оплата не прошла — обновите карту");
  });
});

// ПАРТНЁР С «ТАРИФ: ОПЛАЧИВАЕТ»: платит за календарь аккаунта, который
// пригласил, — кнопкой с его именем, — и только пока подписки нет.
describe("оплата календаря партнёром", () => {
  const fresh: TariffState = { tier: "free", paid: false, forever: false, trial: null, trialUsed: false };

  test("подписки нет — «Оплатить … за <аккаунт>», без пробного", () => {
    assert.deepEqual(partnerTariffAction(fresh, "Giliuta"), {
      kind: "pay",
      label: "Оплатить €9,99 в месяц за Giliuta",
    });
    assert.equal(partnerTariffAction(fresh, null)?.label, "Оплатить €9,99 в месяц");
  });

  test("подписка есть или тариф навсегда — кнопки нет: смена периода — у владельца", () => {
    const paid = { ...fresh, tier: "max" as const, paid: true, trialUsed: true };
    assert.equal(partnerTariffAction(paid, "Giliuta"), null);
    assert.equal(partnerTariffAction({ ...fresh, tier: "max", forever: true }, "Giliuta"), null);
  });
});
