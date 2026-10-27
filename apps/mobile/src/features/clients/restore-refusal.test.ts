import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { overrideUiLocale } from "@babun/shared/i18n/locale";
import { t } from "@babun/shared/i18n/runtime";
import { restoreRefusalWords } from "./restore-refusal";

describe("причина отказа возврата клиента", () => {
  afterEach(() => overrideUiLocale(null));

  test("наш русский текст показывается как есть", () => {
    const why = restoreRefusalWords([
      new Error("restoreClient: JWT expired"),
      new Error("Его номер уже у другого клиента — вернуть нельзя, пока номер занят"),
    ]);
    assert.equal(why, "Его номер уже у другого клиента — вернуть нельзя, пока номер занят");
  });

  test("сырой текст сервера не показывается", () => {
    assert.equal(restoreRefusalWords([new Error("restoreClient: network down")]), undefined);
    assert.equal(restoreRefusalWords(["строка"]), undefined);
    assert.equal(restoreRefusalWords([]), undefined);
  });

  // На другом языке `throw` уже несёт перевод — кириллицы в нём нет, но это
  // всё ещё наш текст для людей, а не общая фраза.
  test("переведённый отказ показывается на языке интерфейса", () => {
    overrideUiLocale("en");
    const translated = t("Его номер уже у другого клиента — вернуть нельзя, пока номер занят");
    assert.ok(!/[А-Яа-яЁё]/.test(translated));
    assert.equal(restoreRefusalWords([new Error(translated)]), translated);
    assert.equal(restoreRefusalWords([new Error("restoreClient: network down")]), undefined);
  });
});
