import { afterEach, describe, expect, it } from "bun:test";
import { isValidElement } from "react";

import { pluralRu } from "../common/utils/plural-ru";
import { overrideUiLocale, pickDeviceLocale, uiIntlTag, uiLocale } from "./locale";
import { UI_LOCALES } from "./locales";
import { isHumanText, t, tDynamic, tf, tj } from "./runtime";

afterEach(() => overrideUiLocale(null));

describe("ui language runtime", () => {
  it("speaks Russian where no language was chosen — tests and servers", () => {
    expect(uiLocale()).toBe("ru");
    expect(t("Клиент")).toBe("Клиент");
    expect(uiIntlTag()).toBe("ru-RU");
  });

  it("fills slots the way the template literal did", () => {
    expect(tf("Удалить «{0}»?", ["Анна"])).toBe("Удалить «Анна»?");
    expect(tf("{0} из {1}", [3, undefined])).toBe("3 из undefined");
  });

  it("folds plain JSX values into text and keeps nodes as nodes", () => {
    expect(tj("Всего {0} записей{1}", [5, false])).toBe("Всего 5 записей");
    expect(isValidElement(tj("Иконка {0} здесь", [{ type: "View", props: {}, key: null, $$typeof: Symbol.for("react.transitional.element") }]))).toBe(true);
  });

  it("looks phrases up in the chosen language and falls back to Russian", () => {
    overrideUiLocale("en");
    expect(uiIntlTag()).toBe("en-GB");
    expect(t("Фраза, которой нет в словаре")).toBe("Фраза, которой нет в словаре");
  });

  it("translates server text when it is printed — verbatim, with values, after a prefix", () => {
    overrideUiLocale("en");
    const exact = tDynamic("Инвойс уже полностью оплачен");
    expect(exact).not.toBe("Инвойс уже полностью оплачен");
    expect(/[А-Яа-яЁё]/.test(exact)).toBe(false);
    const withValues = tDynamic("Платёж превышает остаток 50 EUR");
    expect(withValues).toContain("50");
    expect(withValues).toContain("EUR");
    expect(/[А-Яа-яЁё]/.test(withValues)).toBe(false);
    const prefixed = tDynamic("updateAppointment: Инвойс уже полностью оплачен");
    expect(prefixed).toBe(`updateAppointment: ${exact}`);
    expect(tDynamic("Something unknown")).toBe("Something unknown");
    overrideUiLocale("ru");
    expect(tDynamic("Инвойс уже полностью оплачен")).toBe("Инвойс уже полностью оплачен");
  });

  it("prints a server «заявка» as the product's «запись» in every case form", () => {
    expect(tDynamic("Полученная сумма больше итога заявки")).toBe("Полученная сумма больше итога записи");
    expect(tDynamic("Заявка не найдена")).toBe("Запись не найдена");
    expect(tDynamic("По отменённой заявке оплату не записать")).toBe("По отменённой записи оплату не записать");
    expect(tDynamic("Возвращённую оплату нельзя изменить; создайте новую заявку")).toBe("Возвращённую оплату нельзя изменить; создайте новую запись");
    expect(tDynamic("Клиента с заявками или финансовой историей нельзя удалить")).toBe("Клиента с записями или финансовой историей нельзя удалить");
    expect(tDynamic("% оплат по заявкам, заявкой, в заявках, нет заявок")).toBe("% оплат по записям, записью, в записях, нет записей");
    expect(tDynamic("updateAppointment: Заявка относится к другой команде")).toBe("updateAppointment: Запись относится к другой команде");
    // Только слово целиком: «заявкин» и «подзаявка» — не оно.
    expect(tDynamic("Клиент Заявкин, подзаявка")).toBe("Клиент Заявкин, подзаявка");
    // Перевод знает исходный ключ: на другом языке слово не мешает поиску.
    overrideUiLocale("en");
    expect(/[А-Яа-яЁё]/.test(tDynamic("Полученная сумма больше итога заявки"))).toBe(false);
  });

  it("knows a translated sentence is still text for people", () => {
    overrideUiLocale("en");
    expect(isHumanText(t("Не удалось сохранить"))).toBe(true);
    expect(isHumanText("TypeError: Network request failed")).toBe(false);
    expect(isHumanText("Инвойс не найден")).toBe(true);
  });

  it("counts one/other outside Slavic languages", () => {
    const forms = ["запись", "записи", "записей"] as const;
    expect(pluralRu(21, forms)).toBe("запись");
    overrideUiLocale("en");
    expect(pluralRu(1, forms)).toBe("запись");
    expect(pluralRu(21, forms)).toBe("записей");
    expect(pluralRu(3, forms)).toBe("записей");
    overrideUiLocale("uk");
    expect(pluralRu(3, forms)).toBe("записи");
  });
});

// The dictionaries are written by translators (people or agents). A slot or an
// SMS token lost in translation would print «{0}» or break a template on the
// server — this keeps every entry honest.
describe("dictionaries", () => {
  const slots = (s: string) => [...s.matchAll(/\{(\d+)\}/g)].map((m) => m[1]).sort().join(",");
  const tokens = (s: string) => (s.match(/\[[А-Яа-яЁё ]+\]/g) ?? []).sort().join(",");

  for (const { code } of UI_LOCALES.filter((l) => l.code !== "ru")) {
    it(`${code}: every translation keeps slots and SMS tokens`, async () => {
      const dict = (await import(`./dict/${code}.json`)).default as Record<string, string>;
      for (const [source, translated] of Object.entries(dict)) {
        expect(typeof translated).toBe("string");
        expect(translated.trim().length > 0 || source.trim().length === 0).toBe(true);
        expect(`${source} → ${slots(translated)}`).toBe(`${source} → ${slots(source)}`);
        expect(`${source} → ${tokens(translated)}`).toBe(`${source} → ${tokens(source)}`);
      }
    });
  }

  // ПЕРВЫЙ ЗАПУСК — ЯЗЫК ЧЕЛОВЕКА (владелец 04.10): первый знакомый из языков
  // телефона или браузера, иначе английский, а не русский.
  it("a fresh device speaks the first of its own languages the app knows", () => {
    expect(pickDeviceLocale(["el-GR"])).toBe("el");
    expect(pickDeviceLocale(["fr-FR", "de-DE", "ru-RU"])).toBe("de");
    expect(pickDeviceLocale(["uk_UA"])).toBe("uk");
    expect(pickDeviceLocale(["RU"])).toBe("ru");
    expect(pickDeviceLocale(["fr-FR", "it-IT"])).toBe("en");
    expect(pickDeviceLocale([])).toBe("en");
  });
});
