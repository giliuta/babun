import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  canAddPartner,
  canAddTeam,
  tierAllows,
  tierLine,
  tierOf,
  trialLeft,
  tariffAction,
  tariffStatus,
  trialUsed,
  workingTeamIds,
  type TariffState,
} from "./tiers";

// ТАРИФЫ «СОЛО · ПРО · МАКС» (владелец 01.10): без тарифа — события и свои
// финансы; Соло — клиенты, записи, документы; Про — 5 команд и 5 партнёров;
// Макс — 50 и 50.

describe("действующий тариф", () => {
  test("сервер отдаёт tier — он и есть", () => {
    assert.equal(tierOf({ tier: "pro", plan: "free" }), "pro");
  });

  test("до наката — по старым полям", () => {
    assert.equal(tierOf({ plan: "free", plan_override: null }), "free");
    assert.equal(tierOf({ plan: "free", plan_override: "lifetime" }), "max");
    assert.equal(tierOf({ plan: "business" }), "max");
  });

  test("партнёр до наката тарифа не видит — неизвестно, экран не режет", () => {
    assert.equal(tierOf({ plan: "" }), null);
    assert.equal(tierAllows(null, "clients"), true);
  });
});

describe("что открывает тариф", () => {
  test("без тарифа — ни клиентов, ни записей клиентов, ни партнёров", () => {
    assert.equal(tierAllows("free", "clients"), false);
    assert.equal(tierAllows("free", "book-clients"), false);
    assert.equal(tierAllows("free", "documents"), false);
    assert.equal(tierAllows("free", "partners"), false);
  });

  test("Соло — клиенты и документы, но не партнёры и не новые команды", () => {
    assert.equal(tierAllows("solo", "clients"), true);
    assert.equal(tierAllows("solo", "sms"), true);
    assert.equal(tierAllows("solo", "partners"), false);
    assert.equal(canAddTeam("solo", 1), false);
  });

  test("Про — до 5 команд и 5 партнёров, Макс — до 50", () => {
    assert.equal(canAddTeam("pro", 4), true);
    assert.equal(canAddTeam("pro", 5), false);
    assert.equal(canAddPartner("pro", 5), false);
    assert.equal(canAddTeam("max", 49), true);
    assert.equal(canAddTeam("max", 50), false);
  });
});

describe("пробный период", () => {
  const now = new Date("2026-10-01T12:00:00Z");

  test("идёт — тариф и сколько дней осталось", () => {
    const left = trialLeft({ trial_tier: "pro", trial_ends_at: "2026-10-10T12:00:00Z" }, now);
    assert.deepEqual(left, { tier: "pro", days: 9 });
    assert.equal(tierLine("pro", left), "Про · пробный, ещё 9 дней");
  });

  test("кончился или не начинался — нет", () => {
    assert.equal(trialLeft({ trial_tier: "pro", trial_ends_at: "2026-09-30T12:00:00Z" }, now), null);
    assert.equal(trialLeft({ trial_tier: null, trial_ends_at: null }, now), null);
  });

  test("второй раз не даётся", () => {
    assert.equal(trialUsed({ trial_started_at: "2026-09-01T00:00:00Z" }), true);
    assert.equal(trialUsed({ trial_started_at: null }), false);
  });

  test("подпись: один день, без тарифа", () => {
    assert.equal(tierLine("solo", { days: 1 }), "Соло · пробный, ещё 1 день");
    assert.equal(tierLine("free", null), "Без тарифа");
  });
});

describe("рабочие команды сверх лимита", () => {
  const teams = [
    { id: "a", created_at: "2026-01-01", is_active: true },
    { id: "b", created_at: "2026-02-01", is_active: true },
    { id: "c", created_at: "2026-03-01", is_active: true },
    { id: "z", created_at: "2025-12-01", is_active: false },
  ];

  test("в пределах лимита работают все живые", () => {
    assert.deepEqual([...workingTeamIds(teams, "pro", null)].sort(), ["a", "b", "c"]);
  });

  test("без выбора — первые по созданию, архивная место не занимает", () => {
    assert.deepEqual([...workingTeamIds(teams, "solo", null)], ["a"]);
  });

  test("выбор владельца — первым, свободное место добирается по созданию", () => {
    assert.deepEqual([...workingTeamIds(teams, "solo", ["c"])], ["c"]);
    // Выбранная ушла в архив — её место не пропадает.
    assert.deepEqual([...workingTeamIds(teams, "solo", ["z", "c"])], ["c"]);
    // Лимит вырос (Соло → Про), а выбрана одна: остальные места — по созданию.
    const seven = "abcdefg".split("").map((id, i) => ({ id, created_at: `2026-0${i + 1}-01`, is_active: true }));
    assert.deepEqual([...workingTeamIds(seven, "pro", ["g"])].sort(), ["a", "b", "c", "d", "g"]);
  });
});

describe("действие страницы «Тариф»", () => {
  const fresh: TariffState = { tier: "free", paid: false, forever: false, trial: null, trialUsed: false };

  test("новый аккаунт — пробный на выбранный тариф", () => {
    assert.deepEqual(tariffAction(fresh, "pro"), { kind: "trial", label: "Попробовать 14 дней" });
    assert.equal(tariffStatus(fresh), "Календарь и события");
  });

  test("идёт пробный или он кончился — оплата выбранного", () => {
    const trial = { ...fresh, tier: "pro" as const, trial: { tier: "pro" as const, days: 3 }, trialUsed: true };
    assert.deepEqual(tariffAction(trial, "pro"), { kind: "pay", label: "Оплатить €29.99 в месяц" });
    assert.equal(tariffStatus(trial), "Пробный · ещё 3 дня");
    const over = { ...fresh, trialUsed: true };
    assert.equal(tariffAction(over, "solo")?.label, "Оплатить €6.99 в месяц");
    assert.equal(tariffStatus(over), "Пробный закончился");
  });

  test("свой оплаченный и выданный навсегда — без кнопки", () => {
    const paid = { ...fresh, tier: "pro" as const, paid: true, trialUsed: true };
    assert.equal(tariffAction(paid, "pro"), null);
    assert.deepEqual(tariffAction(paid, "max"), { kind: "change", label: "Перейти на Макс" });
    assert.equal(tariffAction({ ...paid, tier: "max", forever: true }, "solo"), null);
    assert.equal(tariffStatus({ ...paid, forever: true }), "Навсегда");
  });
});
