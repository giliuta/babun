import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { personCardView } from "./person-card";

describe("карта человека в Кабинете", () => {
  test("имя сверху, под ним почта и телефон, инициалы из двух слов", () => {
    assert.deepEqual(
      personCardView({
        email: "artem@example.com",
        user_metadata: { full_name: "  артём гилюта ", phone: "+35799123456" },
      }),
      {
        title: "артём гилюта",
        lines: ["artem@example.com", "+35799123456"],
        initials: "АГ",
      },
    );
  });

  test("без имени на его месте почта, и второй раз она не печатается", () => {
    assert.deepEqual(
      personCardView({ email: "airfix.cy@gmail.com", user_metadata: {} }),
      { title: "airfix.cy@gmail.com", lines: [], initials: "A" },
    );
  });

  test("пустое имя из пробелов — всё равно что имени нет", () => {
    const view = personCardView({
      email: "a@b.cy",
      user_metadata: { full_name: "   ", phone: "+357 99 000000" },
    });
    assert.equal(view.title, "a@b.cy");
    assert.deepEqual(view.lines, ["+357 99 000000"]);
  });

  test("не строки в метаданных не печатаются", () => {
    const view = personCardView({
      email: "a@b.cy",
      user_metadata: { full_name: 42, phone: { e164: "+357" } },
    });
    assert.equal(view.title, "a@b.cy");
    assert.deepEqual(view.lines, []);
  });

  test("сессии ещё нет — нейтральная карта, а не падение", () => {
    assert.deepEqual(personCardView(null), {
      title: "Аккаунт",
      lines: [],
      initials: "А",
    });
  });

  test("однословное имя даёт одну букву", () => {
    assert.equal(
      personCardView({ email: "x@y.cy", user_metadata: { full_name: "Янис" } })
        .initials,
      "Я",
    );
  });
});
