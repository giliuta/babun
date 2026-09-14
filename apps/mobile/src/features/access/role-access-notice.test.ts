import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { roleAccessNotice } from "./role-access-notice";

const TAIL = "Эти положения начнут действовать, когда включим права по блокам.";

describe("roleAccessNotice", () => {
  test("диспетчер в одном календаре", () => {
    assert.equal(
      roleAccessNotice("dispatcher", "Диспетчер", ["Команда 1"]),
      `Сейчас доступ задаёт роль «Диспетчер»: записи, клиенты и телефоны в календаре «Команда 1». ${TAIL}`,
    );
  });

  test("диспетчер в двух календарях", () => {
    assert.equal(
      roleAccessNotice("dispatcher", "Диспетчер", ["Команда 1", "Команда 2"]),
      `Сейчас доступ задаёт роль «Диспетчер»: записи, клиенты и телефоны в календарях «Команда 1», «Команда 2». ${TAIL}`,
    );
  });

  test("диспетчер без прикреплений видит все календари", () => {
    assert.equal(
      roleAccessNotice("dispatcher", "Диспетчер", []),
      `Сейчас доступ задаёт роль «Диспетчер»: записи, клиенты и телефоны во всех календарях. ${TAIL}`,
    );
  });

  test("мастер в календаре — свои записи без сумм", () => {
    assert.equal(
      roleAccessNotice("master", "Бригадир / мастер", ["Команда 1"]),
      `Сейчас доступ задаёт роль «Бригадир / мастер»: свои записи в календаре «Команда 1», без сумм. ${TAIL}`,
    );
  });

  test("мастер без прикреплений — без места", () => {
    assert.equal(
      roleAccessNotice("master", "Бригадир / мастер", []),
      `Сейчас доступ задаёт роль «Бригадир / мастер»: свои записи, без сумм. ${TAIL}`,
    );
  });

  test("календари назвать нельзя — только то, что известно", () => {
    assert.equal(roleAccessNotice("dispatcher", "Диспетчер", null), TAIL);
  });

  test("роли нет или она не сотрудника — только хвост", () => {
    assert.equal(roleAccessNotice(null, null, ["Команда 1"]), TAIL);
    assert.equal(roleAccessNotice("owner", "Владелец", ["Команда 1"]), TAIL);
  });
});
