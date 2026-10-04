import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { clientSettingsDoor, type ClientSettingsDoorInput } from "./settings-door";

// ШЕСТЕРЁНКА ЛИСТА — В НАБОР КОМАНДЫ И КОМПАНИИ, КОТОРЫЙ ЛИСТ ПОКАЗЫВАЕТ
// (аудит 03.10): без команды подстраница правила набор телефона, а партнёр
// попадал в свою компанию со всеми правами.

const owner = (over: Partial<ClientSettingsDoorInput> = {}): ClientSettingsDoorInput => ({
  pathname: "/clients/channels",
  teamId: "team-1",
  tenantId: "own",
  level: "write",
  owner: true,
  member: false,
  teamKnown: true,
  ...over,
});

const partner = (over: Partial<ClientSettingsDoorInput> = {}): ClientSettingsDoorInput =>
  owner({ tenantId: "employer", owner: false, member: true, ...over });

describe("шестерёнка листов «Связаться», «Добавить», «Маршрут»", () => {
  test("адрес несёт команду и компанию набора", () => {
    assert.deepEqual(clientSettingsDoor(owner()), {
      pathname: "/clients/channels",
      params: { team: "team-1", tenant: "own" },
    });
  });

  test("партнёр на клиенте работодателя — в компании работодателя, а не в своей", () => {
    assert.deepEqual(clientSettingsDoor(partner({ level: "read" })), {
      pathname: "/clients/channels",
      params: { team: "team-1", tenant: "employer" },
    });
  });

  test("строка «Скрыта» — двери нет", () => {
    assert.equal(clientSettingsDoor(partner({ level: "hidden" })), null);
    assert.equal(clientSettingsDoor(owner({ level: "hidden" })), null);
  });

  test("без источника «всё открыто» — только владельцу", () => {
    // Запись и календарь: источника нет, уровни запасные.
    assert.equal(clientSettingsDoor(owner({ owner: false, member: false })), null);
    assert.notEqual(clientSettingsDoor(owner({ member: false })), null);
  });

  test("команда чужой компании — двери нет, правка ушла бы не туда", () => {
    assert.equal(clientSettingsDoor(owner({ teamKnown: false })), null);
  });

  test("набор компании без команды — адрес без команды", () => {
    assert.deepEqual(clientSettingsDoor(owner({ teamId: null, teamKnown: false })), {
      pathname: "/clients/channels",
      params: { tenant: "own" },
    });
  });

  // 03.10: общий адрес стоит на тех же воротах строки, что вкладочный
  // (`ClientSettingsRoute`), — роль календаря его больше не закрывает.
  test("общий адрес из записи — по той же строке, что вкладка", () => {
    const shared = { pathname: "/maps" } as const;
    assert.deepEqual(clientSettingsDoor(partner({ ...shared, level: "read" })), {
      pathname: "/maps",
      params: { team: "team-1", tenant: "employer" },
    });
    assert.equal(clientSettingsDoor(partner({ ...shared, level: "hidden" })), null);
    assert.deepEqual(clientSettingsDoor(owner(shared)), {
      pathname: "/maps",
      params: { team: "team-1", tenant: "own" },
    });
  });

  test("компания неизвестна — адрес без неё", () => {
    assert.deepEqual(clientSettingsDoor(owner({ tenantId: null })), {
      pathname: "/clients/channels",
      params: { team: "team-1" },
    });
  });
});
