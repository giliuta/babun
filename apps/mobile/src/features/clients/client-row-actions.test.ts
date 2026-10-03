import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { clientRowActions, type ClientRowRights } from "./client-row-actions";

// Своя компания владельца: всё можно, календарь открыт.
const OWNER: ClientRowRights = { edit: true, manage: true, export: true, book: true };
// Работодатель партнёра (`capabilitiesOf` источника «member»): хозяйства и
// выгрузки нет; «Записать» — только когда его календарь открыт.
const EMPLOYER_OPEN: ClientRowRights = { edit: true, manage: false, export: false, book: true };
const EMPLOYER_CLOSED: ClientRowRights = { ...EMPLOYER_OPEN, book: false };

const blocks = (menu: string, del: string) => ({
  blocks: { clients: "read", "clients.menu": menu, "clients.delete": del },
});

describe("строка списка клиентов: жесты и меню по компании строки", () => {
  test("своя строка владельца — всё как было", () => {
    const a = clientRowActions({ client: {}, guest: false, selecting: false, rights: OWNER, teamCreate: true });
    assert.deepEqual(a, {
      select: false,
      menu: true,
      remind: true,
      blacklist: true,
      remove: true,
      share: true,
      selectMany: true,
      book: true,
    });
    // Без права записи в команде — нет «Записать», остальное на месте.
    assert.equal(clientRowActions({ client: {}, guest: false, selecting: false, rights: OWNER }).book, false);
  });

  test("гость с «Меню клиента: Меняет» — меню, «Напомнить», без «Удалить» и без выбора", () => {
    const a = clientRowActions({
      client: blocks("write", "off"),
      guest: true,
      selecting: false,
      rights: EMPLOYER_OPEN,
      teamCreate: true,
    });
    assert.equal(a.menu, true, "долгое нажатие гасилось у настоящего партнёра");
    assert.equal(a.remind, true);
    assert.equal(a.blacklist, true);
    assert.equal(a.share, true);
    assert.equal(a.remove, false);
    assert.equal(a.select, false);
    assert.equal(a.selectMany, false, "клиентов работодателя не выгружают и не рассылают");
    assert.equal(a.book, true);
  });

  test("гость: «Записать» — только когда календарь работодателя открыт и есть право записи", () => {
    const base = { client: blocks("write", "off"), guest: true, selecting: false };
    assert.equal(clientRowActions({ ...base, rights: EMPLOYER_CLOSED, teamCreate: true }).book, false);
    assert.equal(clientRowActions({ ...base, rights: EMPLOYER_OPEN, teamCreate: false }).book, false);
  });

  test("гость только с «Удаление клиента: Может» — меню и свайп «Удалить», без «Напомнить»", () => {
    const a = clientRowActions({
      client: blocks("read", "write"),
      guest: true,
      selecting: false,
      rights: EMPLOYER_OPEN,
      teamCreate: true,
    });
    assert.equal(a.menu, true);
    assert.equal(a.remove, true);
    assert.equal(a.remind, false);
    assert.equal(a.blacklist, false);
    assert.equal(a.share, false);
    assert.equal(a.book, false, "«Записать» партнёру — с «Меню клиента»");
    assert.equal(a.selectMany, false);
  });

  test("гость без обоих прав — ни меню, ни свайпов", () => {
    const a = clientRowActions({
      client: blocks("read", "off"),
      guest: true,
      selecting: false,
      rights: EMPLOYER_OPEN,
      teamCreate: true,
    });
    assert.deepEqual(Object.values(a).filter(Boolean), []);
  });

  test("гость без `blocks` (сервер до наката) — ничего: права своей базы к нему не относятся", () => {
    const a = clientRowActions({ client: {}, guest: true, selecting: false, rights: OWNER, teamCreate: true });
    assert.deepEqual(Object.values(a).filter(Boolean), []);
  });

  test("строка партнёра вне гостей (зеркало) — по тем же блокам, выбор — по «Меню клиента»", () => {
    const a = clientRowActions({
      client: blocks("write", "write"),
      guest: false,
      selecting: false,
      rights: EMPLOYER_OPEN,
      teamCreate: true,
    });
    assert.equal(a.menu, true);
    assert.equal(a.remind, true);
    assert.equal(a.remove, true);
    // «Выбрать несколько» партнёру не даётся никогда — и «его глазами» тоже.
    assert.equal(a.selectMany, false);
  });

  test("режим выбора: своя строка отмечается, гостевая молчит, свайпов нет ни у кого", () => {
    const own = clientRowActions({ client: {}, guest: false, selecting: true, rights: OWNER });
    assert.equal(own.select, true);
    assert.equal(own.menu, false);
    assert.equal(own.remind, false);
    assert.equal(own.remove, false);

    const guest = clientRowActions({
      client: blocks("write", "write"),
      guest: true,
      selecting: true,
      rights: EMPLOYER_OPEN,
    });
    assert.equal(guest.select, false, "гостя в выбор не берут");
    assert.equal(guest.menu, false);
    assert.equal(guest.remind, false);
    assert.equal(guest.remove, false);
  });

  test("своя база без права карточки и тарифа — меню только при хозяйстве или записи", () => {
    const readOnly: ClientRowRights = { edit: false, manage: false, export: false, book: false };
    const a = clientRowActions({ client: {}, guest: false, selecting: false, rights: readOnly });
    assert.deepEqual(Object.values(a).filter(Boolean), []);
  });
});
