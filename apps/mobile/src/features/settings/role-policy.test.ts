import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  allow,
  can,
  canAccessCabinetPath,
  canAccessClientPath,
  effectivePlan,
  isUserRole,
  planAllows,
} from "./role-policy";

describe("role policy", () => {
  test("accepts only database membership roles", () => {
    assert.equal(isUserRole("owner"), true);
    assert.equal(isUserRole("dispatcher"), true);
    assert.equal(isUserRole("master"), true);
    assert.equal(isUserRole("admin"), false);
    assert.equal(isUserRole(null), false);
  });

  test("keeps finance and company management owner-only", () => {
    assert.equal(can("owner", "view-finances"), true);
    assert.equal(can("owner", "manage-company"), true);
    assert.equal(can("dispatcher", "view-finances"), false);
    assert.equal(can("dispatcher", "manage-company"), false);
    assert.equal(can("master", "view-finances"), false);
  });

  test("lets dispatcher operate clients and calendar", () => {
    assert.equal(can("dispatcher", "operate-clients"), true);
    assert.equal(can("dispatcher", "operate-calendar"), true);
    assert.equal(can("dispatcher", "create-appointment"), true);
    assert.equal(can("master", "operate-clients"), false);
    assert.equal(can("master", "operate-calendar"), true);
    assert.equal(can("master", "create-appointment"), false);
  });

  test("keeps the unfinished device-local chat prototype unreachable", () => {
    assert.equal(can("owner", "manage-messaging"), false);
    assert.equal(can("dispatcher", "manage-messaging"), false);
    assert.equal(can("master", "manage-messaging"), false);
  });

  test("uses an explicit cabinet route allow-list for non-owners", () => {
    assert.equal(canAccessCabinetPath("owner", "/cabinet/accounts"), true);
    assert.equal(canAccessCabinetPath("dispatcher", "/cabinet/recurring"), true);
    assert.equal(canAccessCabinetPath("dispatcher", "/cabinet/unclosed"), true);
    assert.equal(canAccessCabinetPath("master", "/cabinet/business/"), true);
    assert.equal(canAccessCabinetPath(null, "/cabinet"), false);
  });

  // МАСТЕРА УЕХАЛИ ИЗ КАБИНЕТА В НАСТРОЙКИ КАЛЕНДАРЯ (2026-09-10). Путь
  // /cabinet/masters больше не существует, поэтому проверять его в списке
  // кабинета нечего — но право обязано остаться владельческим: стек
  // /calendar закрыт капабилити `manage-calendar-settings`.
  test("мастера остались владельческими и на новом месте", () => {
    assert.equal(can("owner", "manage-calendar-settings"), true);
    assert.equal(can("dispatcher", "manage-calendar-settings"), false);
    assert.equal(can("master", "manage-calendar-settings"), false);
  });

  test("every cabinet link rendered for dispatcher and master is reachable", () => {
    const dispatcherLinks = [
      "/cabinet",
      "/cabinet/account",
      "/cabinet/business",
      "/cabinet/inventory",
      "/cabinet/recurring",
      "/cabinet/sms-templates",
      "/cabinet/unclosed",
    ];
    const masterLinks = [
      "/cabinet",
      "/cabinet/account",
      "/cabinet/business",
      "/cabinet/inventory",
    ];
    const ownerOnlyLinks = [
      "/cabinet/accounts",
      "/cabinet/categories",
      "/cabinet/close-day",
      "/cabinet/event-types",
      "/cabinet/insights",
      "/cabinet/labels",
      "/cabinet/loyalty",
      "/cabinet/services",
      "/cabinet/team-access",
      "/cabinet/templates",
    ];

    for (const path of dispatcherLinks) {
      assert.equal(canAccessCabinetPath("dispatcher", path), true, path);
    }
    for (const path of masterLinks) {
      assert.equal(canAccessCabinetPath("master", path), true, path);
    }
    for (const path of ownerOnlyLinks) {
      assert.equal(canAccessCabinetPath("dispatcher", path), false, path);
      assert.equal(canAccessCabinetPath("master", path), false, path);
    }
  });

  test("allows a master only an exact assigned-client detail route", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    assert.equal(canAccessClientPath("master", `/clients/${id}`), true);
    assert.equal(canAccessClientPath("master", "/clients"), false);
    assert.equal(canAccessClientPath("master", "/clients/settings"), false);
    assert.equal(canAccessClientPath("master", "/clients/archive"), false);
    assert.equal(canAccessClientPath("master", `/clients/${id}/edit`), false);
    assert.equal(canAccessClientPath("dispatcher", "/clients/settings"), true);
  });
});

describe("тариф", () => {
  test("ручная выдача сильнее оплаченного тарифа", () => {
    assert.equal(effectivePlan({ plan: "free", plan_override: "lifetime" }), "lifetime");
    assert.equal(effectivePlan({ plan: "free", plan_override: null }), "free");
    assert.equal(effectivePlan({ plan: "pro" }), "pro");
    // Пустая строка — это «ничего не записано», а не тариф с пустым именем:
    // `TENANT_SAFE_DEFAULTS` ставит именно её, пока профиль не приехал.
    assert.equal(effectivePlan({ plan: "", plan_override: "" }), null);
    assert.equal(effectivePlan(null), null);
    assert.equal(effectivePlan(undefined), null);
  });

  test("бесплатный уровень закрывает работу с клиентами", () => {
    assert.equal(planAllows("free", "book-clients"), false);
    assert.equal(planAllows("free", "services"), false);
    assert.equal(planAllows("free", "masters"), false);
    assert.equal(planAllows("free", "documents"), false);
  });

  test("платный, ручной и НЕИЗВЕСТНЫЙ тариф пускают всё", () => {
    for (const plan of ["pro", "business", "lifetime", "beta_unlimited", "solo-2027"]) {
      assert.equal(planAllows(plan, "book-clients"), true, plan);
      assert.equal(planAllows(plan, "documents"), true, plan);
    }
  });

  test("незагруженный тариф не режет экран", () => {
    // Пока профиль компании не приехал, экран обязан вести себя как обычно:
    // мигание «нельзя → можно» на холодном старте читается как поломка, а
    // настоящий замок всё равно стоит в базе (`enforce_plan_limits`).
    assert.equal(planAllows(null, "book-clients"), true);
    assert.equal(planAllows(undefined, "book-clients"), true);
  });

  test("дверь пускает, только когда согласны и роль, и тариф", () => {
    // Роль запрещает, тариф разрешает.
    assert.equal(
      allow({ role: "master", plan: "lifetime" }, "view-finances"),
      false,
    );
    // Роль разрешает, тариф запрещает.
    assert.equal(
      allow({ role: "owner", plan: "free" }, "create-appointment", "book-clients"),
      false,
    );
    // Согласны оба.
    assert.equal(
      allow({ role: "owner", plan: "lifetime" }, "create-appointment", "book-clients"),
      true,
    );
    // Без тарифного вопроса дверь спрашивает только роль — иначе каждый
    // существующий вызов пришлось бы переписывать.
    assert.equal(allow({ role: "dispatcher", plan: "free" }, "operate-calendar"), true);
  });
});
