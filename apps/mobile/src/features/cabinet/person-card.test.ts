import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { birthdayText, personCardView } from "./person-card";

describe("карта человека в Кабинете", () => {
  test("имя, компания и факты: почта, номер, день рождения", () => {
    assert.deepEqual(
      personCardView(
        {
          email: "artem@example.com",
          user_metadata: {
            full_name: "  артём гилюта ",
            phone: "+35799123456",
            birthday: "1990-03-12",
          },
        },
        "AirFix",
      ),
      {
        title: "артём гилюта",
        company: "AirFix",
        facts: [
          { kind: "email", text: "artem@example.com" },
          { kind: "phone", text: "+357 99 123 456" },
          { kind: "birthday", text: "12 марта 1990" },
        ],
        initials: "АГ",
      },
    );
  });

  test("компания с тем же именем, что и человек, второй раз не печатается", () => {
    const view = personCardView(
      { email: "a@b.cy", user_metadata: { full_name: "Giliuta" } },
      " giliuta ",
    );
    assert.equal(view.company, null);
  });

  test("без имени на его месте почта, и второй раз она не печатается", () => {
    assert.deepEqual(
      personCardView({ email: "airfix.cy@gmail.com", user_metadata: {} }),
      { title: "airfix.cy@gmail.com", company: null, facts: [], initials: "A" },
    );
  });

  test("пустое имя из пробелов — всё равно что имени нет", () => {
    const view = personCardView({
      email: "a@b.cy",
      user_metadata: { full_name: "   ", phone: "+357 99 000000" },
    });
    assert.equal(view.title, "a@b.cy");
    assert.deepEqual(view.facts, [{ kind: "phone", text: "+357 99 000 000" }]);
  });

  test("не строки в метаданных не печатаются", () => {
    const view = personCardView({
      email: "a@b.cy",
      user_metadata: { full_name: 42, phone: { e164: "+357" }, birthday: 19900312 },
    });
    assert.equal(view.title, "a@b.cy");
    assert.deepEqual(view.facts, []);
  });

  test("сессии ещё нет — нейтральная карта, а не падение", () => {
    assert.deepEqual(personCardView(null), {
      title: "Аккаунт",
      company: null,
      facts: [],
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

  test("день рождения: кривая и несуществующая дата не печатаются", () => {
    assert.equal(birthdayText("2001-01-05"), "5 января 2001");
    assert.equal(birthdayText("1990-02-31"), "");
    assert.equal(birthdayText("12.03.1990"), "");
    assert.equal(birthdayText(""), "");
  });
});
