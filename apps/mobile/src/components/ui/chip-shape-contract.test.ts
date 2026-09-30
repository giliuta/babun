import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// ЧИП ДЕРЖИТ УГОЛ КНОПКИ — СЛОВО ВЛАДЕЛЬЦА 21.09.
//
// «Давай изменим все чипы, чтоб они были квадратные с закруглением, как
// кнопка». До этого чип был пилюлей (`radius.pill`, 999): на высоте 32pt это
// радиус 16, и лента чипов читалась как чужая порода рядом с кнопкой футера и
// карточкой блока.
//
// Сторож держит не число, а РАВЕНСТВО: чип берёт тот же токен радиуса, что и
// кнопка. Поменяется угол кнопки — чип обязан поехать за ней, и тест скажет об
// этом, а не промолчит, потому что «10 всё ещё равно 10».

const here = dirname(fileURLToPath(import.meta.url));
const read = (name: string) => readFileSync(join(here, name), "utf8");
const radiusTokens = (src: string) =>
  new Set([...src.matchAll(/borderRadius: t\.radius\.(\w+)/g)].map((m) => m[1]));

describe("вид: чип и кнопка", () => {
  test("чип закруглён ровно как кнопка", () => {
    const chip = radiusTokens(read("Chip.tsx"));
    const button = radiusTokens(read("Button.tsx"));
    assert.ok(button.size > 0, "Button больше не задаёт радиус токеном темы");
    assert.deepEqual(
      chip,
      button,
      `чип закруглён иначе, чем кнопка: чип ${[...chip]}, кнопка ${[...button]}`,
    );
  });

  test("пилюля в чип не возвращается", () => {
    assert.doesNotMatch(
      read("Chip.tsx"),
      /radius\.pill|borderRadius: 999/,
      "чип снова пилюля — владелец просил угол кнопки",
    );
  });
});
