import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { nextDateForWeekday, upcomingOccurrences } from "./label-schedule";

// 2026-08-31 — понедельник. От неё и считаем во всех случаях.
const MONDAY = "2026-08-31";
const none = () => null;

describe("даты, на которые встанет расписание метки", () => {
  test("без выбранных дней дат нет", () => {
    assert.deepEqual(
      upcomingOccurrences({
        weekdays: [],
        fromYmd: MONDAY,
        limit: 5,
        assignedOn: none,
        ownName: null,
      }),
      [],
    );
  });

  test("сегодняшний день входит в список, а не пропускается", () => {
    // Иначе выбор «понедельник» в понедельник показывал бы первой датой
    // следующую неделю — и человек решил бы, что сегодня метка не встанет.
    const got = upcomingOccurrences({
      weekdays: [1],
      fromYmd: MONDAY,
      limit: 3,
      assignedOn: none,
      ownName: null,
    });
    assert.deepEqual(
      got.map((o) => o.ymd),
      [MONDAY, "2026-09-07", "2026-09-14"],
    );
  });

  test("несколько дней недели идут вперемешку, по возрастанию даты", () => {
    const got = upcomingOccurrences({
      weekdays: [2, 4],
      fromYmd: MONDAY,
      limit: 4,
      assignedOn: none,
      ownName: null,
    });
    assert.deepEqual(
      got.map((o) => o.ymd),
      ["2026-09-01", "2026-09-03", "2026-09-08", "2026-09-10"],
    );
  });

  test("ЗАНЯТАЯ РУКОЙ ДАТА НАЗЫВАЕТ ХОЗЯИНА, А НЕ ИСЧЕЗАЕТ", () => {
    // Владелец: «если в пятницу 4 сентября поставлена другая метка, то
    // автоматически туда проставляться не должно». Резолвер календаря так и
    // делает; список обязан ЭТО ПОКАЗАТЬ — молчаливый пропуск неотличим от
    // поломки. Поэтому дата остаётся в списке, но с именем занявшего.
    const got = upcomingOccurrences({
      weekdays: [5],
      fromYmd: MONDAY,
      limit: 2,
      assignedOn: (ymd) => (ymd === "2026-09-04" ? "Пафос" : null),
      ownName: "Кипр",
    });
    assert.deepEqual(got, [
      { ymd: "2026-09-04", weekday: 5, takenBy: "Пафос" },
      { ymd: "2026-09-11", weekday: 5, takenBy: null },
    ]);
  });

  test("своё же имя занятостью не считается", () => {
    // Метка, уже стоящая на дате руками, не конфликтует сама с собой —
    // иначе правка собственного графика показывала бы её как чужую.
    const got = upcomingOccurrences({
      weekdays: [5],
      fromYmd: MONDAY,
      limit: 1,
      assignedOn: () => "Кипр",
      ownName: "Кипр",
    });
    assert.equal(got[0]?.takenBy, null);
  });

  test("воскресенье не теряется", () => {
    // ISO-7 против `getDay()`-0: перепутанная нумерация обрезала бы список
    // ровно в выходной, где ошибку заметят последней.
    const got = upcomingOccurrences({
      weekdays: [7],
      fromYmd: MONDAY,
      limit: 2,
      assignedOn: none,
      ownName: null,
    });
    assert.deepEqual(
      got.map((o) => o.ymd),
      ["2026-09-06", "2026-09-13"],
    );
  });

  test("список не длиннее запрошенного", () => {
    const got = upcomingOccurrences({
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      fromYmd: MONDAY,
      limit: 5,
      assignedOn: none,
      ownName: null,
    });
    assert.equal(got.length, 5);
  });

  test("месяц переходится без сбоя нумерации", () => {
    const got = upcomingOccurrences({
      weekdays: [1],
      fromYmd: "2026-12-28",
      limit: 2,
      assignedOn: none,
      ownName: null,
    });
    assert.deepEqual(
      got.map((o) => o.ymd),
      ["2026-12-28", "2027-01-04"],
    );
  });
});

describe("ближайшая дата дня недели", () => {
  test("сегодня, если день недели совпал", () => {
    assert.equal(nextDateForWeekday(1, MONDAY), MONDAY);
  });

  test("ближайшая вперёд, а не назад", () => {
    assert.equal(nextDateForWeekday(7, MONDAY), "2026-09-06");
  });
});
