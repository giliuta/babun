import { describe, expect, it } from "bun:test";
import { countWordRu } from "./pluralize";
import { formatCountRu, pluralRu } from "./plural-ru";

// Формы для перебора: сами по себе они в продукте не объявлены — набор
// склонений заводят там, где он нужен человеку.
const FORMS_KOMANDA = ["команда", "команды", "команд"] as const;

describe("russian plural", () => {
  // Локальные копии этого правила врали каждая по-своему: одна на 11,
  // другая на 21 («21 команд»). Тест держит обе границы.
  it("picks the form by the last digit, except the teens", () => {
    expect(pluralRu(1, FORMS_KOMANDA)).toBe("команда");
    expect(pluralRu(2, FORMS_KOMANDA)).toBe("команды");
    expect(pluralRu(5, FORMS_KOMANDA)).toBe("команд");
    expect(pluralRu(11, FORMS_KOMANDA)).toBe("команд");
    expect(pluralRu(21, FORMS_KOMANDA)).toBe("команда");
    expect(pluralRu(22, FORMS_KOMANDA)).toBe("команды");
    expect(pluralRu(111, FORMS_KOMANDA)).toBe("команд");
  });

  it("counts nothing as MANY", () => {
    expect(formatCountRu(0, FORMS_KOMANDA)).toBe("0 команд");
    expect(formatCountRu(21, FORMS_KOMANDA)).toBe("21 команда");
  });

  // Вторая форма вызова обязана давать тот же ответ — правило одно.
  it("agrees with the three-word call shape", () => {
    for (const n of [1, 2, 5, 11, 21, 22, 111]) {
      expect(countWordRu(n, ...FORMS_KOMANDA)).toBe(pluralRu(n, FORMS_KOMANDA));
    }
  });
});
