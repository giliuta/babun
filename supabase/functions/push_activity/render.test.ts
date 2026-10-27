import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { moneyLabel, renderActivity, whenLabel, type ActivityFacts } from "./render.ts";

const base: ActivityFacts = {
  kind: "new",
  owner: false,
  date: "2026-10-27",
  time: "14:00",
  client: "Иван Петров",
  city: "Лимассол",
  team: "Y&D",
  amount: null,
  currency: "EUR",
  today: "2026-10-27",
};

describe("текст пуша о делах команды", () => {
  test("мастеру — «Вам назначена работа: 14:00, клиент, город»", () => {
    assert.deepEqual(renderActivity(base, "ru"), {
      title: "Вам назначена работа",
      body: "14:00, Иван Петров, Лимассол",
    });
  });

  test("владельцу новая запись — «Новая работа», не «вам назначена»", () => {
    assert.equal(renderActivity({ ...base, owner: true }, "ru").title, "Новая работа");
  });

  test("перенос, отмена, отмена по ссылке, передача другой команде", () => {
    assert.equal(renderActivity({ ...base, kind: "change" }, "ru").title, "Работу перенесли");
    assert.equal(renderActivity({ ...base, kind: "cancel" }, "ru").title, "Работу отменили");
    assert.equal(renderActivity({ ...base, kind: "cancel_link", owner: true }, "ru").title, "Клиент отменил по ссылке");
    assert.equal(renderActivity({ ...base, kind: "moved" }, "ru").title, "Работу передали другой команде");
  });

  test("без права видеть клиента имени нет", () => {
    assert.equal(renderActivity({ ...base, client: null }, "ru").body, "14:00, Лимассол");
  });

  test("завтра и дальше — день перед временем", () => {
    assert.equal(whenLabel({ date: "2026-10-28", time: "09:05", today: "2026-10-27" }, "ru"), "Завтра, 09:05");
    assert.equal(whenLabel({ date: "2026-10-28", time: "9:05:00", today: "2026-10-27" }, "en"), "Tomorrow, 09:05");
    const far = whenLabel({ date: "2026-11-05", time: "14:00", today: "2026-10-27" }, "ru") ?? "";
    assert.match(far, /^5 нояб\.?, 14:00$/);
  });

  test("оплата — сумма в заголовке, клиент и команда в тексте", () => {
    const paid = renderActivity({ ...base, kind: "payment", amount: 120, owner: true }, "en");
    assert.equal(paid.title, "Paid €120");
    assert.equal(paid.body, "Иван Петров · Y&D");
    assert.match(renderActivity({ ...base, kind: "payment", amount: 120.5 }, "ru").title, /^Оплачено 120,50\s€$/);
  });

  test("неизвестный язык читает английский, известный — свой", () => {
    assert.equal(renderActivity(base, "fr").title, "New job assigned to you");
    assert.equal(renderActivity({ ...base, kind: "cancel" }, "el").title, "Η εργασία ακυρώθηκε");
    assert.equal(renderActivity({ ...base, kind: "cancel" }, "de").title, "Auftrag storniert");
  });

  test("ничего не известно о записи — хотя бы команда", () => {
    const bare = renderActivity({ ...base, date: null, time: null, client: null, city: null }, "ru");
    assert.equal(bare.body, "Y&D");
  });

  test("битая валюта не роняет функцию", () => {
    assert.equal(moneyLabel(10, "??", "ru"), "10 ??");
  });
});
