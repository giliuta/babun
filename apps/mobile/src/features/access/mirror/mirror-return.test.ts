import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { returnHrefOf } from "./mirror-return";

describe("выход из «его глазами» — на страницу, откуда вошли (01.10)", () => {
  test("страница прав раздела: путь с сотрудником и все параметры адреса", () => {
    const href = returnHrefOf(
      "/cabinet/people/access/user-7",
      ["(dashboard)", "cabinet", "people", "access", "[userId]"],
      { userId: "user-7", team: "team-1", rights: "1", calendar: "team-1", group: "clients" },
    );
    assert.equal(href, "/cabinet/people/access/user-7?team=team-1&rights=1&calendar=team-1&group=clients");
  });

  test("без параметров — просто путь; пустые и повторы — как в адресе", () => {
    assert.equal(returnHrefOf("/cabinet/people/new", ["(dashboard)", "cabinet", "people", "new"], {}), "/cabinet/people/new");
    assert.equal(
      returnHrefOf("/x", ["x"], { a: undefined, b: ["1", "2"], c: "привет мир" }),
      "/x?b=1&b=2&c=%D0%BF%D1%80%D0%B8%D0%B2%D0%B5%D1%82+%D0%BC%D0%B8%D1%80",
    );
  });

  test("хвостовой сегмент `[...rest]` тоже в пути", () => {
    assert.equal(returnHrefOf("/a/b/c", ["a", "[...rest]"], { rest: ["b", "c"], q: "1" }), "/a/b/c?q=1");
  });
});

describe("возвращается вся цепочка страниц, а не одна (01.10)", () => {
  test("стек «Кабинета» → адреса снизу вверх", async () => {
    const { stackHrefsOf } = await import("./mirror-return");
    const hrefs = stackHrefsOf("/cabinet/people/access/u-1", [
      { name: "index", params: {} },
      { name: "people/index", params: { team: "t-1" } },
      { name: "people/access/[userId]", params: { userId: "u-1", team: "t-1" } },
      {
        name: "people/access/[userId]",
        params: { userId: "u-1", team: "t-1", rights: "1", calendar: "t-1", group: "clients" },
      },
    ]);
    assert.deepEqual(hrefs, [
      "/cabinet",
      "/cabinet/people?team=t-1",
      "/cabinet/people/access/u-1?team=t-1",
      "/cabinet/people/access/u-1?team=t-1&rights=1&calendar=t-1&group=clients",
    ]);
  });

  test("вложенные объекты в параметрах не ломают адрес; чужой путь — null", async () => {
    const { stackHrefsOf } = await import("./mirror-return");
    assert.deepEqual(
      stackHrefsOf("/cabinet/people/new", [{ name: "people/new", params: { screen: { a: 1 } } }]),
      ["/cabinet/people/new"],
    );
    assert.equal(stackHrefsOf("/finances", [{ name: "people/new" }]), null);
    assert.equal(stackHrefsOf("/cabinet", []), null);
  });
});

describe("возврат доходит, даже если первый переход не долетел", () => {
  const CHAIN = ["/cabinet", "/cabinet/people?team=t", "/cabinet/people/access/u?rights=1"];

  test("в корне цепочки — достроить остальное, один раз", async () => {
    const { rememberReturn, returnStep } = await import("./mirror-return");
    rememberReturn(CHAIN, 1000);
    assert.deepEqual(returnStep("/cabinet", 1500), { push: CHAIN.slice(1) });
    assert.equal(returnStep("/cabinet", 1600), null, "второй раз не повторяет");
  });

  test("не в корне — снова в корень, но не больше двух раз", async () => {
    const { rememberReturn, returnStep } = await import("./mirror-return");
    rememberReturn(CHAIN, 1000);
    assert.deepEqual(returnStep("/clients", 1100), { navigate: "/cabinet" });
    assert.deepEqual(returnStep("/clients", 1200), { navigate: "/cabinet" });
    assert.equal(returnStep("/clients", 1300), null);
    assert.equal(returnStep("/cabinet", 1400), null, "после отказа забыто");
  });

  test("старый возврат не срабатывает; пустая цепочка — ничего", async () => {
    const { rememberReturn, returnStep } = await import("./mirror-return");
    rememberReturn(CHAIN, 1000);
    assert.equal(returnStep("/cabinet", 7000), null);
    rememberReturn([], 1000);
    assert.equal(returnStep("/cabinet", 1100), null);
  });
});
