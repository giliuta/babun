import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { birthdayText, personCardView } from "./person-card";

const here = dirname(fileURLToPath(import.meta.url));

describe("карта человека в Кабинете", () => {
  test("имя, под ним почта и номер — без компании, дня рождения и инициалов", () => {
    assert.deepEqual(
      personCardView({
        email: "artem@example.com",
        user_metadata: {
          full_name: "  артём гилюта ",
          phone: "+35799123456",
          birthday: "1990-03-12",
        },
      }),
      {
        title: "артём гилюта",
        lines: [
          { kind: "email", text: "artem@example.com" },
          { kind: "phone", text: "+357 99 123 456" },
        ],
      },
    );
  });

  test("номера нет — только почта", () => {
    assert.deepEqual(
      personCardView({ email: "a@b.cy", user_metadata: { full_name: "Giliuta" } }).lines,
      [{ kind: "email", text: "a@b.cy" }],
    );
  });

  test("без имени на его месте почта, и второй раз она не печатается", () => {
    assert.deepEqual(
      personCardView({ email: "airfix.cy@gmail.com", user_metadata: {} }),
      { title: "airfix.cy@gmail.com", lines: [] },
    );
  });

  test("пустое имя из пробелов — всё равно что имени нет", () => {
    const view = personCardView({
      email: "a@b.cy",
      user_metadata: { full_name: "   ", phone: "+357 99 000000" },
    });
    assert.equal(view.title, "a@b.cy");
    assert.deepEqual(view.lines, [{ kind: "phone", text: "+357 99 000 000" }]);
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
    assert.deepEqual(personCardView(null), { title: "Аккаунт", lines: [] });
  });

  test("карта без кругляша, витрины и строки компании", () => {
    const source = readFileSync(resolve(here, "./PersonCard.tsx"), "utf8");
    assert.doesNotMatch(source, /initials|LinearGradient|useOwnAccountName/);
    assert.match(source, /<SectionCard>/);
  });

  test("день рождения: кривая и несуществующая дата не печатаются", () => {
    assert.equal(birthdayText("2001-01-05"), "5 января 2001");
    assert.equal(birthdayText("1990-02-31"), "");
    assert.equal(birthdayText("12.03.1990"), "");
    assert.equal(birthdayText(""), "");
  });
});
