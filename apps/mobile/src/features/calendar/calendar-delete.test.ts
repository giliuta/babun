import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  ARCHIVE_CALENDAR_MESSAGE,
  calendarDeleteImpact,
  eraseCalendarMessage,
} from "./calendar-delete";

const TEAM = "team-2";
const OTHER = "team-1";
const END = " Клиенты останутся в базе. Вернуть будет нельзя.";

describe("шаг «в архив» — обратимый и короткий", () => {
  test("говорит, куда уходит и где стереть навсегда", () => {
    assert.ok(ARCHIVE_CALENDAR_MESSAGE.startsWith("Он уйдёт в архив"));
    assert.ok(ARCHIVE_CALENDAR_MESSAGE.includes("карточках клиентов"));
    assert.ok(ARCHIVE_CALENDAR_MESSAGE.includes("Кабинете → Архив"));
  });

  // Цифр в обратимом шаге нет: «удалятся 14 записей» там было бы неправдой.
  test("не пугает цифрами того, чего не случится", () => {
    assert.ok(!/\d/.test(ARCHIVE_CALENDAR_MESSAGE));
    assert.ok(!ARCHIVE_CALENDAR_MESSAGE.includes("удалятся"));
  });
});

describe("что уйдёт при стирании", () => {
  test("считаем ВСЕ его записи, прошлые тоже, и не трогаем соседей", () => {
    const impact = calendarDeleteImpact({
      teamId: TEAM,
      appointments: [{ team_id: TEAM }, { team_id: TEAM }, { team_id: OTHER }],
      accounts: [{ brigade_id: TEAM }, { brigade_id: OTHER }, { brigade_id: null }],
      documents: [],
    });
    assert.deepEqual(impact, { appointments: 2, accounts: 1, documents: 0 });
  });

  // УЖЕ АННУЛИРОВАННЫЙ ДОКУМЕНТ НЕ СЧИТАЕТСЯ: сервер штампует только живые,
  // и вопрос не должен пугать тем, что уже случилось.
  test("документы — только живые", () => {
    const impact = calendarDeleteImpact({
      teamId: TEAM,
      appointments: [],
      accounts: [],
      documents: [
        { brigade_id: TEAM, status: "issued" },
        { brigade_id: TEAM, status: "void" },
        { brigade_id: OTHER, status: "issued" },
      ],
    });
    assert.equal(impact.documents, 1);
  });
});

describe("вопрос «удалить навсегда» называет цену", () => {
  test("«Команда 2» как она была в базе", () => {
    assert.equal(
      eraseCalendarMessage({ appointments: 14, accounts: 2, documents: 1 }),
      `Вместе с ним удалятся: 14 записей, 2 счёта со всеми операциями. 1 инвойс будет аннулирован.${END}`,
    );
  });

  test("пустой календарь не пугает несуществующим", () => {
    const message = eraseCalendarMessage({ appointments: 0, accounts: 0, documents: 0 });
    assert.ok(message.startsWith("Записей и счетов у него нет"));
    assert.ok(!message.includes("аннулир"));
    assert.ok(message.endsWith(END));
  });

  // КЛИЕНТЫ ОСТАЮТСЯ — СЛОВО ВЛАДЕЛЬЦА, а «вернуть нельзя» — правда о шаге.
  // Обе фразы звучат при любом раскладе.
  test("про клиентов и необратимость сказано всегда", () => {
    for (const impact of [
      { appointments: 1, accounts: 0, documents: 0 },
      { appointments: 0, accounts: 3, documents: 2 },
    ]) {
      assert.ok(eraseCalendarMessage(impact).endsWith(END));
    }
  });

  test("одна запись, один счёт, два инвойса — формы слов", () => {
    assert.equal(
      eraseCalendarMessage({ appointments: 1, accounts: 1, documents: 2 }),
      `Вместе с ним удалятся: 1 запись, 1 счёт со всеми операциями. 2 инвойса будут аннулированы.${END}`,
    );
  });

  test("одиннадцать — не «11 запись»", () => {
    assert.ok(
      eraseCalendarMessage({ appointments: 11, accounts: 0, documents: 0 }).includes(
        "11 записей",
      ),
    );
  });
});
