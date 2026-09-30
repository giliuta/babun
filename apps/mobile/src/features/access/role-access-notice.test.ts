import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { roleAccessNotice } from "./role-access-notice";

const TAIL = "Эти положения начнут действовать, когда включим права по блокам.";

describe("roleAccessNotice", () => {
  test("диспетчер в одном календаре", () => {
    assert.equal(
      roleAccessNotice("dispatcher", ["Команда 1"]),
      `Сейчас видит записи, клиентов и телефоны в календаре «Команда 1». ${TAIL}`,
    );
  });

  test("диспетчер в двух календарях", () => {
    assert.equal(
      roleAccessNotice("dispatcher", ["Команда 1", "Команда 2"]),
      `Сейчас видит записи, клиентов и телефоны в календарях «Команда 1», «Команда 2». ${TAIL}`,
    );
  });

  test("диспетчер без прикреплений видит все календари", () => {
    assert.equal(
      roleAccessNotice("dispatcher", []),
      `Сейчас видит записи, клиентов и телефоны во всех календарях. ${TAIL}`,
    );
  });

  test("мастер в календаре — записи без сумм, статус и заметка", () => {
    assert.equal(
      roleAccessNotice("master", ["Команда 1"]),
      `Сейчас видит записи в календаре «Команда 1» без сумм, меняет в них статус и заметку. ${TAIL}`,
    );
  });

  test("мастер без прикреплений — свои записи", () => {
    assert.equal(
      roleAccessNotice("master", []),
      `Сейчас видит свои записи без сумм, меняет в них статус и заметку. ${TAIL}`,
    );
  });

  test("роль в строке не называется", () => {
    for (const role of ["dispatcher", "master"]) {
      assert.doesNotMatch(roleAccessNotice(role, ["Команда 1"]), /роль/i);
    }
  });

  test("календари назвать нельзя — только то, что известно", () => {
    assert.equal(roleAccessNotice("dispatcher", null), TAIL);
  });

  test("роли нет или она не сотрудника — только хвост", () => {
    assert.equal(roleAccessNotice(null, ["Команда 1"]), TAIL);
    assert.equal(roleAccessNotice("owner", ["Команда 1"]), TAIL);
  });
});
