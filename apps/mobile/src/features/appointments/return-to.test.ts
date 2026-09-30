import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { financesFrom, resolveReturnTo, returnToParam } from "./return-to";

const ACCOUNT = "7f0e2c1a-3b4d-4e5f-8a9b-0c1d2e3f4a5b";

describe("resolveReturnTo", () => {
  test("без метки дороги нет — остаёмся там, куда привела навигация", () => {
    assert.equal(resolveReturnTo(undefined), null);
    assert.equal(resolveReturnTo(""), null);
  });

  test("вкладка денег", () => {
    assert.equal(resolveReturnTo("finances"), "/finances");
  });

  test("страница инвойса несёт свой id", () => {
    assert.equal(resolveReturnTo("invoice:abc-123"), "/invoices/abc-123");
  });

  test("инвойс без id не уводит на несуществующий маршрут", () => {
    assert.equal(resolveReturnTo("invoice:"), null);
    assert.equal(resolveReturnTo("invoice:  "), null);
  });

  test("разрез вкладки денег восстанавливается из адреса", () => {
    assert.equal(resolveReturnTo("finances:income"), "/finances?view=income");
    assert.equal(resolveReturnTo("finances:debt"), "/finances?view=debt");
    assert.equal(resolveReturnTo("finances:accounts"), "/finances?view=accounts");
  });

  test("«Счета» возвращаются вместе с выбранным счётом", () => {
    assert.equal(
      resolveReturnTo(`finances:accounts:${ACCOUNT}`),
      `/finances?view=accounts&account=${ACCOUNT}`,
    );
  });

  test("счёт из адреса — только uuid и только у «Счетов»", () => {
    assert.equal(
      resolveReturnTo("finances:accounts:1&view=profit"),
      "/finances?view=accounts",
    );
    assert.equal(
      resolveReturnTo(`finances:income:${ACCOUNT}`),
      "/finances?view=income",
    );
  });

  test("незнакомый разрез открывает корень денег, а не собирает адрес из метки", () => {
    assert.equal(resolveReturnTo("finances:profit&x=1"), "/finances");
    assert.equal(resolveReturnTo("finances:../cabinet"), "/finances");
    assert.equal(resolveReturnTo("finances:"), "/finances");
  });

  test("незнакомая метка игнорируется", () => {
    assert.equal(resolveReturnTo("calendar"), null);
    assert.equal(resolveReturnTo("invoices:abc"), null);
    // Страницы операций счёта больше нет: метка старой сборки никуда не ведёт.
    assert.equal(resolveReturnTo(`account:${ACCOUNT}`), null);
  });
});

describe("returnToParam", () => {
  test("собирается только когда дорога передана", () => {
    assert.equal(returnToParam(undefined), "");
    assert.equal(returnToParam("finances"), "&from=finances");
  });

  test("экранирует id доноров", () => {
    assert.equal(returnToParam("invoice:a b"), "&from=invoice%3Aa%20b");
  });
});

describe("команда чипа в дороге назад (30.09)", () => {
  const TEAM = "team-mp8qhxe3-55axz";

  test("метка несёт разрез, счёт и команду; «Все» — корень", () => {
    assert.equal(financesFrom("all", { team: TEAM }), `finances@${TEAM}`);
    assert.equal(financesFrom("debt", { team: TEAM }), `finances:debt@${TEAM}`);
    assert.equal(
      financesFrom("accounts", { account: ACCOUNT, team: TEAM }),
      `finances:accounts:${ACCOUNT}@${TEAM}`,
    );
    assert.equal(financesFrom(null, {}), "finances");
  });

  test("возврат встаёт на ту же команду", () => {
    assert.equal(resolveReturnTo(`finances@${TEAM}`), `/finances?team=${TEAM}`);
    assert.equal(resolveReturnTo(`finances:income@${TEAM}`), `/finances?view=income&team=${TEAM}`);
    assert.equal(
      resolveReturnTo(`finances:accounts:${ACCOUNT}@${TEAM}`),
      `/finances?view=accounts&account=${ACCOUNT}&team=${TEAM}`,
    );
    assert.equal(resolveReturnTo("finances@__no_team__"), "/finances?team=__no_team__");
  });

  test("мусор вместо команды отбрасывается, разрез остаётся", () => {
    assert.equal(resolveReturnTo("finances:debt@a&view=x"), "/finances?view=debt");
    assert.equal(resolveReturnTo("finances@"), "/finances");
    assert.equal(resolveReturnTo("finances:../cabinet@team_x"), "/finances?team=team_x");
  });

  test("круг: метка вкладки — тот же адрес вкладки", () => {
    for (const view of ["all", "income", "expense", "debt", "documents", "accounts"]) {
      const back = resolveReturnTo(financesFrom(view, { team: TEAM }));
      assert.ok(back?.includes(`team=${TEAM}`), `${view}: ${back}`);
    }
  });
});
