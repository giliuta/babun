import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { nameToCommit, nameToSend, shownName } from "./name-commit";

describe("имя счёта в строке", () => {
  test("пишется только новое непустое имя, без пробелов по краям", () => {
    assert.equal(nameToSend(null, "Касса"), null);
    assert.equal(nameToSend("   ", "Касса"), null);
    assert.equal(nameToSend(" Касса ", "Касса"), null);
    assert.equal(nameToSend(" Касса 2 ", "Касса"), "Касса 2");
  });

  test("пока набирают и пока ждут ответа — стоит набранное", () => {
    assert.equal(shownName("Касс", null, "Касса"), "Касс");
  });

  test("после успеха до перечитывания — отправленное, а не старое имя", () => {
    const sent = { sent: "Касса 2", from: "Касса" };
    assert.equal(shownName(null, sent, "Касса"), "Касса 2");
  });

  test("список перечитан или имя сменили с другого устройства — из списка", () => {
    const sent = { sent: "Касса 2", from: "Касса" };
    assert.equal(shownName(null, sent, "Касса 2"), "Касса 2");
    assert.equal(shownName(null, sent, "Сейф"), "Сейф");
  });

  test("вернули прежнее имя до перечитывания — оно пишется, а не теряется", () => {
    const sent = { sent: "Касса 2", from: "Касса" };
    // Список ещё держит «Касса», строка показывает «Касса 2».
    assert.equal(nameToCommit("Касса", sent, "Касса"), "Касса");
    // То, что и так стоит в строке, второй раз не шлём.
    assert.equal(nameToCommit("Касса 2", sent, "Касса"), null);
    assert.equal(nameToCommit(null, sent, "Касса"), null);
  });
});
