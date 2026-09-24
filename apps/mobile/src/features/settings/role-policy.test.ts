import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  allow,
  cabinetScreenRole,
  can,
  canAccessCabinetPath,
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

  // ЛИЧНОЕ — ДЛЯ ВСЕХ РОЛЕЙ (15.09): приглашения и профиль принадлежат человеку.
  // Без этого мастер, которого позвали в календарь, упёрся бы в «Недостаточно
  // прав» ровно на странице, где принимают приглашение.
  test("личные страницы Кабинета открыты любой роли", () => {
    for (const path of [
      "/cabinet/invitations",
      "/cabinet/profile",
      "/cabinet/notifications",
      "/cabinet/about",
      "/cabinet/company",
      "/cabinet/company?tenant=0b6f2d1e-3c4a-4b5d-8e9f-a1b2c3d4e5f6",
    ]) {
      assert.equal(canAccessCabinetPath("owner", path), true, path);
      assert.equal(canAccessCabinetPath("dispatcher", path), true, path);
      assert.equal(canAccessCabinetPath("master", path), true, path);
      assert.equal(canAccessCabinetPath(null, path), false, path);
    }
  });

  test("every cabinet link rendered for dispatcher and master is reachable", () => {
    const dispatcherLinks = [
      "/cabinet",
      "/cabinet/account",
      "/cabinet/business",
      "/cabinet/inventory",
      "/cabinet/recurring",
      "/cabinet/sms-templates",
      "/cabinet/invitations",
      "/cabinet/profile",
      "/cabinet/notifications",
      "/cabinet/about",
      "/cabinet/company",
    ];
    const masterLinks = [
      "/cabinet",
      "/cabinet/account",
      "/cabinet/business",
      "/cabinet/inventory",
      // Лист «SMS» ведёт в шаблоны того, кому их открыли (STORY-089).
      "/cabinet/sms-templates",
      "/cabinet/invitations",
      "/cabinet/profile",
      "/cabinet/notifications",
      "/cabinet/about",
      "/cabinet/company",
    ];
    // «Сводка» переехала из владельческих в общие (владелец 20.09: значок
    // аналитики стоит всегда, «открывается, ну значит не будет данных там»).
    const sharedLinks = ["/cabinet/insights"];
    const ownerOnlyLinks = [
      "/cabinet/accounts",
      "/cabinet/categories",
      "/cabinet/event-types",
      "/cabinet/labels",
      "/cabinet/services",
      "/cabinet/templates",
    ];

    for (const path of dispatcherLinks) {
      assert.equal(canAccessCabinetPath("dispatcher", path), true, path);
    }
    for (const path of masterLinks) {
      assert.equal(canAccessCabinetPath("master", path), true, path);
    }
    for (const path of sharedLinks) {
      assert.equal(canAccessCabinetPath("dispatcher", path), true, path);
      assert.equal(canAccessCabinetPath("master", path), true, path);
    }
    for (const path of ownerOnlyLinks) {
      assert.equal(canAccessCabinetPath("dispatcher", path), false, path);
      assert.equal(canAccessCabinetPath("master", path), false, path);
    }
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

describe("роль экрана Кабинета", () => {
  const MINE = "2bc7907e-b149-44a9-92ff-a5e73403031c";
  const EMPLOYER = "11365a87-bef9-4f6c-a030-b15083fe646b";
  const memberships = [
    { tenantId: MINE, role: "owner" },
    { tenantId: EMPLOYER, role: "master" },
  ];

  test("без компании в ссылке судит активная роль", () => {
    assert.equal(cabinetScreenRole("master", null, memberships), "master");
  });

  test("своя компания в ссылке — владелец, хотя в календаре открыта чужая", () => {
    assert.equal(cabinetScreenRole("master", MINE, memberships), "owner");
    // И дверь аналитики при этом открыта.
    assert.equal(
      canAccessCabinetPath(cabinetScreenRole("master", MINE, memberships), "/cabinet/categories"),
      true,
    );
  });

  test("чужой идентификатор в ссылке ничего не открывает", () => {
    // Адрес намеренно владельческий: «Сводка» с 20.09 открыта всем ролям, и
    // на ней подмену ссылки было бы не видно.
    const alien = "aaaaaaaa-1111-2222-3333-444444444444";
    assert.equal(cabinetScreenRole("master", alien, memberships), "master");
    assert.equal(
      canAccessCabinetPath(cabinetScreenRole("master", alien, memberships), "/cabinet/categories"),
      false,
    );
  });

  test("неизвестная строка роли в членстве не считается ролью", () => {
    const broken = [{ tenantId: MINE, role: "superuser" }];
    assert.equal(cabinetScreenRole("master", MINE, broken), "master");
  });

  test("членства ещё не пришли — судит активная роль", () => {
    assert.equal(cabinetScreenRole("owner", MINE, undefined), "owner");
  });
});
