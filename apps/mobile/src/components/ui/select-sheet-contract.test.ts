import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative: string) => readFileSync(resolve(here, relative), "utf8");

// ШТОРКА ВЫБОРА ОДНА НА ПРОДУКТ — И ЭТО ПРОВЕРЯЕТСЯ, А НЕ ОБЕЩАЕТСЯ
// (владелец 2026-09-10: «архитектура этой шторки должна быть везде
// одинаковая»).
//
// Канон был записан комментарием внутри `BookingPickers` — и следовали ему две
// шторки из семи, потому что следовать было нечему: строка лежала копиями.
// Копии разошлись до трёх высот (44/48/52), трёх полей поиска и трёх способов
// нарисовать заголовок. Тест сторожит ровно это: строку и поиск рисует общий
// примитив, шапку задаёт проп.

/** Все шторки, где ВЫБИРАЮТ из списка. Новая шторка выбора добавляется сюда
 *  тем же коммитом, которым появляется. */
const SHEETS = [
  "../../features/clients/ClientPickerSheet.tsx",
  "../../features/clients/ObjectPickerSheet.tsx",
  "../../features/clients/TagPickerSheet.tsx",
  "../../features/reference/LabelPickerSheet.tsx",
  "../../features/appointments/BookingPickers.tsx",
  "./PickerSheet.tsx",
  "./ValuePickerSheet.tsx",
];

describe("анатомия шторки выбора", () => {
  test("строку рисует только общий примитив", () => {
    for (const path of SHEETS) {
      const source = read(path);
      // Своя высота строки = своя анатомия. Единственное законное место, где
      // высота названа числом, — сам примитив.
      assert.doesNotMatch(
        source,
        /minHeight: 4[48]|minHeight: 5[26]/,
        `${path}: своя высота строки вместо SelectRow`,
      );
      assert.match(
        source,
        /SelectRow|ValueOptionList/,
        `${path}: строка собрана руками, а не общим примитивом`,
      );
    }
  });

  test("поиск — общий, второго поля в шторках не бывает", () => {
    for (const path of SHEETS) {
      const source = read(path);
      assert.doesNotMatch(
        source,
        /<TextInput/,
        `${path}: своё поле поиска вместо SelectSearch`,
      );
    }
  });

  test("шапка задаётся пропом, а не рисуется в теле", () => {
    for (const path of SHEETS) {
      const source = read(path);
      assert.match(
        source,
        /title=\{|title="/,
        `${path}: у шторки нет title — заголовок нарисован вручную`,
      );
      assert.doesNotMatch(
        source,
        /accessibilityRole="header"/,
        `${path}: свой заголовок в теле шторки`,
      );
    }
  });

  test("примитив строки держит канон: 52pt, плитка 28, имя 15/600", () => {
    const row = read("./select-rows.tsx");
    assert.match(row, /minHeight: 52/);
    // Плитка КВАДРАТНАЯ и того же радиуса, что у блока «Вид»: круглым остался
    // только аватар клиента с буквой.
    assert.match(row, /const TILE = 28/);
    assert.match(row, /borderRadius: avatar \? t\.radius\.pill : PICKER_RADIUS/);
    assert.match(row, /fontSize: 15, fontWeight: "600"/);
    // Галка у выбранной и тонировка строки — признак выбора, а не рамка.
    assert.match(row, /<Check color=\{t\.accent\}/);
    assert.doesNotMatch(row, /borderWidth/);
  });

  // ВЫБРАННОЕ В ФОРМЕ — ПЛИТКОЙ ШТОРКИ (владелец 2026-09-15: «выбранное должно
  // показываться так же, как в шторке — блок с подсветкой и иконкой — во
  // всех»). Команда и метка в шапке записи рисовались бледным кружком, а их
  // шторки — квадратной плиткой; у команды к тому же разными глифами.
  test("команда и метка в форме — плитка шторки, карточка белая", () => {
    const card = read("../../features/appointments/TeamLabelRow.tsx");
    const row = read("./select-rows.tsx");
    assert.match(card, /<AppearanceTile\b/, "выбранное в шапке формы снова не плитка шторки");
    const tile = row.match(/const TILE = (\d+)/)?.[1];
    assert.ok(tile, "не нашёл размер плитки строки шторки");
    assert.match(
      card,
      new RegExp(`const CHOSEN_TILE = ${tile};`),
      "плитка выбранного в форме разошлась по размеру с плиткой шторки",
    );
    assert.match(card, /size=\{CHOSEN_TILE\}/);
    // Кружок остаётся ТОЛЬКО у пустого значения (владелец 2026-09-10 выбрал
    // его глазами); выбранное кружком больше не рисуется.
    assert.match(card, /\{muted \? \(\s*<View\s+style=\{\{\s*width: 26,/, "пустая «Метка» перестала быть кружком");
    // Карточки белые (владелец 2026-09-06: «эти блоки не должны окрашиваться»).
    assert.doesNotMatch(card, /appearanceRowFill|\$\{color\}14|\$\{color\}24/, "карточка шапки окрасилась");
    assert.match(card, /<Card style=\{\{ flex: 1 \}\}>/, "карточка шапки больше не белая `Card`");
  });

  test("глиф команды один и тот же в плитке и в шторке", () => {
    const card = read("../../features/appointments/TeamLabelRow.tsx");
    const sheet = read("../../features/appointments/BookingSheets.tsx");
    const book = read("../../../app/book/index.tsx");
    assert.doesNotMatch(
      sheet,
      /icon=\{Circle\}|import \{[^}]*\bCircle\b[^}]*\} from "lucide-react-native"/,
      "в шторке команды вернулся пустой кружок",
    );

    const tileGlyph = card.match(/teamIcon = (\w+),/)?.[1];
    const sheetGlyph = sheet.match(/<SelectRow\s+key=\{team\.id\}\s+icon=\{(\w+)\}/)?.[1];
    assert.ok(tileGlyph && sheetGlyph, "не нашёл глиф команды в плитке или в шторке");
    assert.equal(sheetGlyph, tileGlyph, "шторка команды и плитка команды рисуют разные глифы");
    assert.match(sheet, /color=\{team\.color \?\? t\.accent\}/, "цвет команды без своего цвета разошёлся с плиткой");

    // Шторка команды СОБЫТИЯ: «Личное» и команды — теми же глифами, что плитка.
    const personalGlyph = book.match(/id: "personal",\s*label: "Личное",\s*icon: (\w+),/)?.[1];
    const teamRowGlyph = book.match(/\.\.\.teams\.map\(\(tm\) => \(\{[^}]*?icon: (\w+),/)?.[1];
    const eventTile = book.match(/teamIcon=\{teamId == null \? (\w+) : (\w+)\}/);
    assert.ok(personalGlyph && teamRowGlyph && eventTile, "не нашёл глифы команды события");
    assert.equal(eventTile[1], personalGlyph, "«Личное» в плитке и в шторке — разные глифы");
    assert.equal(eventTile[2], teamRowGlyph, "команда события в плитке и в шторке — разные глифы");
    assert.equal(teamRowGlyph, tileGlyph);
    // Текущий выбор отмечен — «Личное» тоже.
    assert.match(
      book,
      /visible=\{eventTeamSheetOpen\}[\s\S]{0,400}?selectedId=\{teamId \?\? "personal"\}/,
      "шторка команды события не отмечает текущий выбор",
    );
  });
});
