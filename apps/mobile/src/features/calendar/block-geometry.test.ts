import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  chipOverflowW,
  chipPad,
  chipTextW,
  chipsThatFit,
  rowsThatFit,
  textRows,
  TEXT_MIN_W,
} from "./block-geometry";

/** Ширина колонки недели: экран минус рельс часов, делённое на семь, минус
 *  волосяная линия сетки слева. */
const weekCell = (screen: number) => (screen - 48) / 7 - 1;
/** Ширина полосы Дня: экран минус рельс, минус линия. */
const dayCell = (screen: number) => screen - 48 - 1;

const LINE_H = 16;

describe("строки блока", () => {
  test("строка либо целиком, либо её нет", () => {
    // Обвязка 6pt: одна строка требует 22, две — 38, три — 54.
    assert.equal(rowsThatFit(21, LINE_H), 0);
    assert.equal(rowsThatFit(22, LINE_H), 1);
    assert.equal(rowsThatFit(37, LINE_H), 1);
    assert.equal(rowsThatFit(38, LINE_H), 2);
    assert.equal(rowsThatFit(54, LINE_H), 3);
  });

  test("получасовая запись при обычном зуме печатает ОДНУ строку", () => {
    // Прежняя формула floor((cardH − 9)/lineH) + 1 давала здесь две, и время
    // рисовалось разрезанным пополам обрезкой карточки.
    const cardH = 28; // 30 минут при 60pt на час, минус 2pt дыхания
    assert.equal(textRows(cardH, LINE_H), 1);
  });

  test("у самого низкого блока имя всё равно пытается напечататься", () => {
    assert.equal(textRows(10, LINE_H), 1);
    assert.equal(textRows(0, LINE_H), 1);
  });

  test("потолок три строки держится", () => {
    assert.equal(textRows(500, LINE_H), 3);
  });

  test("крупный системный шрифт поднимает порог вместе со строкой", () => {
    assert.equal(textRows(38, 21), 1);
    assert.equal(textRows(48, 21), 2);
  });
});

describe("чипы «весь день»", () => {
  test("резерв под «+N» растёт по разрядам", () => {
    assert.equal(chipOverflowW(1), 12);
    assert.equal(chipOverflowW(9), 12);
    assert.equal(chipOverflowW(10), 16);
    assert.equal(chipOverflowW(100), 20);
  });

  test("паддинг чипа сужается вместе с ним", () => {
    assert.equal(chipPad(120), 6);
    assert.equal(chipPad(70), 4);
    assert.equal(chipPad(46), 3);
  });

  test("ИМЯ ОСТАЁТСЯ НА ЛЮБОМ ЭКРАНЕ И ПРИ ЛЮБОМ ЧИСЛЕ СОБЫТИЙ", () => {
    // Тот самый дефект: резерв под «+N» вычитался ПОСЛЕ решения «сколько
    // чипов», и на 375 и 390pt чип со счётчиком выходил безымянным цветным
    // прямоугольником — ровно тем корешком, который правка и убирала.
    for (const screen of [375, 390, 393, 402, 414, 430, 440]) {
      for (const total of [1, 2, 3, 5, 10]) {
        const cell = weekCell(screen);
        const shown = chipsThatFit(cell, total);
        assert.ok(shown >= 1, `${screen}pt/${total}: ни одного чипа`);
        const w = (cell - 2 * (shown - 1)) / shown;
        const rest = total - shown;
        const textW = chipTextW(w, rest > 0 ? chipOverflowW(rest) : 0);
        assert.ok(
          textW >= TEXT_MIN_W,
          `неделя ${screen}pt, событий ${total}: имени нет (${textW.toFixed(1)} < ${TEXT_MIN_W})`,
        );
      }
    }
  });

  test("известный предел: двузначный счётчик в колонке недели съедает имя", () => {
    // Одиннадцать и больше событий «весь день» в ОДНОМ дне узкой колонки:
    // «+11» требует 16pt резерва, и на 375pt имени остаётся 21.7 при пороге 24.
    // Тогда чип печатает только счётчик — он и есть дверь в День, а имя живёт
    // в озвучке. Предел назван вслух, чтобы его не «чинили» молча сужением
    // порога текста.
    const cell = weekCell(375);
    assert.equal(chipsThatFit(cell, 12), 1);
    assert.ok(chipTextW(cell, chipOverflowW(11)) < TEXT_MIN_W);
    // При однозначном счётчике имя есть.
    assert.ok(chipTextW(cell, chipOverflowW(9)) >= TEXT_MIN_W);
  });

  test("в колонке недели помещается ровно один чип", () => {
    for (const screen of [375, 393, 430]) {
      assert.equal(chipsThatFit(weekCell(screen), 5), 1, `${screen}pt`);
    }
  });

  test("в Дне чипов много, но последний тоже с именем", () => {
    const cell = dayCell(393);
    assert.ok(chipsThatFit(cell, 3) === 3);
    const shown = chipsThatFit(cell, 12);
    assert.ok(shown >= 5 && shown < 12, `показано ${shown}`);
    const w = (cell - 2 * (shown - 1)) / shown;
    assert.ok(chipTextW(w, chipOverflowW(12 - shown)) >= TEXT_MIN_W);
  });

  test("пустой список и нулевая ширина не ломают счёт", () => {
    assert.equal(chipsThatFit(300, 0), 0);
    assert.equal(chipsThatFit(0, 3), 0);
  });
});
