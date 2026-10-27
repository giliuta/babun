import { afterEach, describe, expect, it } from "bun:test";
import { overrideUiLocale } from "../../i18n/locale";
import { t, tf } from "../../i18n/runtime";
import { countWordRu } from "./pluralize";
import { formatCountRu, pluralPhraseRu, pluralRu } from "./plural-ru";

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

describe("a whole phrase for the ONE count", () => {
  afterEach(() => overrideUiLocale(null));

  // «Удалить 1 клиента?» и «Удалить 2 клиента?» — одно русское слово, но в
  // словаре оно одно и читалось бы «Delete 1 clients?». Фраза для ONE —
  // отдельный ключ; здесь сторожим, КОГДА она берётся.
  it("takes the ONE phrase for 1 and 21 in Russian and Ukrainian", () => {
    for (const locale of ["ru", "uk"] as const) {
      overrideUiLocale(locale);
      expect(pluralPhraseRu(1, "one", "other")).toBe("one");
      expect(pluralPhraseRu(21, "one", "other")).toBe("one");
      expect(pluralPhraseRu(2, "one", "other")).toBe("other");
      expect(pluralPhraseRu(5, "one", "other")).toBe("other");
      expect(pluralPhraseRu(11, "one", "other")).toBe("other");
    }
  });

  // Так фразу собирает плагин сборки: целая фраза для ONE — `tf`, слово
  // для остальных — `t`. «Delete 1 clients?» больше не собирается.
  it("reads singular after 1 and plural after 2 in English", () => {
    overrideUiLocale("en");
    const ask = (n: number) =>
      pluralPhraseRu(
        n,
        tf("Удалить {0} клиента?", [n]),
        tf("Удалить {0} {1}?", [n, t(pluralRu(n, ["клиента", "клиента", "клиентов"]))]),
      );
    expect(ask(1)).toBe("Delete 1 client?");
    expect(ask(2)).toBe("Delete 2 clients?");
    expect(ask(21)).toBe("Delete 21 clients?");
  });

  it("takes it only for exactly 1 in one/other languages", () => {
    for (const locale of ["en", "bg", "el", "de", "es"] as const) {
      overrideUiLocale(locale);
      expect(pluralPhraseRu(1, "one", "other")).toBe("one");
      expect(pluralPhraseRu(21, "one", "other")).toBe("other");
      expect(pluralPhraseRu(2, "one", "other")).toBe("other");
      expect(pluralPhraseRu(5, "one", "other")).toBe("other");
    }
  });
});
