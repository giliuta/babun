import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative: string) => readFileSync(resolve(here, relative), "utf8");

// ЖИЛЬЦЫ ОБЪЕКТА: ОДНА ДВЕРЬ, ОДНО ОКНО ЗА РАЗ, ОДНА ШТОРКА ВЫБОРА (STORY-086).
//
// Три правила этого участка держатся не кодом, а решением — и именно такие
// ломаются молча, «заодно», при следующей правке рядом:
//
//   1. дверь «Добавить жильца» одна — в листе виллы; под виллами на странице
//      её нет намеренно (у управляющей их десять);
//   2. шторка поднимается ПОСЛЕ ухода листа, по `onExited`, а не по таймеру —
//      иначе iOS отвечает «already presenting» и не показывает ничего;
//   3. выбор человека — та же одна шторка клиента на продукт, с готовым
//      вопросом от двери, а не вторая её копия.
//
// Сторож смотрит в исходники: у этих правил нет ни чистой функции, ни ответа
// сервера, которые можно было бы спросить, — есть разметка и порядок вызовов.

describe("жилец заводится в листе виллы и нигде больше", () => {
  test("дверь «Добавить жильца» одна — в листе объекта, не под каждой виллой", () => {
    const sheet = read("ObjectEditSheet.tsx");
    const block = read("blocks/ObjectsBlock.tsx");
    assert.match(
      sheet,
      /addLabel="Добавить жильца"/,
      "в листе объекта пропала единственная дверь заведения жильца",
    );
    // Ищется ДВЕРЬ, а не слово: почему её здесь нет, написано в самом файле
    // комментарием, и сторож по слову краснел бы на собственном объяснении.
    // Дверь узнаётся по подписи — без неё `ChooseRow` не собирается.
    assert.doesNotMatch(
      block,
      /(add)?[Ll]abel="Добавить жильца"/,
      "дверь жильца вернулась на страницу — у управляющей это десять одинаковых акцентных строк при нуле жильцов",
    );
    const doors = [...block.matchAll(/<ChooseRow[\s\S]*?label="([^"]+)"/g)].map(
      (m) => m[1],
    );
    assert.deepEqual(
      doors,
      ["Добавить объект"],
      "в блоке объектов завелась вторая дверь",
    );
  });

  test("под виллой на странице — только показание, без правки", () => {
    const block = read("blocks/ObjectsBlock.tsx");
    // Строка жильцов приходит готовой и печатается как есть.
    assert.match(block, /residents=\{residentsFor\?\.\(loc\)\}/);
    // Ни строк связей, ни поля роли: правится роль только там, где человек
    // стоит строкой, — в блоке «Клиент» и в «Жильцах» листа.
    for (const forbidden of ["ClientLinksBlock", "LinkRow", "onRoleChange"]) {
      assert.ok(
        !block.includes(forbidden),
        `на странице появился «${forbidden}» — показание жильцов стало правкой`,
      );
    }
  });

  test("шторка поднимается по уходу листа, а не по таймеру", () => {
    const sheet = read("ObjectEditSheet.tsx");
    // Дверь откладывает вызов до `onExited`, а не зовёт его тем же тапом.
    assert.match(
      sheet,
      /afterExit\.current = \(\) => onAddResident\(place\);/,
      "дверь жильца перестала ждать ухода листа — iOS ответит «already presenting»",
    );
    assert.match(
      sheet,
      /onExited=\{\(\) => \{[\s\S]{0,200}?afterExit\.current/,
      "отложенное действие листа больше не запускается по onExited",
    );
    assert.ok(
      !sheet.includes("setTimeout"),
      "в листе объекта появился таймер: он мерит анимацию, а не снятие окна",
    );
  });
});

describe("шторка связи — одна шторка клиента с готовым вопросом", () => {
  test("своей вёрстки выбора у неё нет", () => {
    const link = read("LinkPickerSheet.tsx");
    assert.match(link, /<ClientPickerSheet/);
    for (const forbidden of ["<TextInput", "<SelectRow", "<BottomSheet"]) {
      assert.ok(
        !link.includes(forbidden),
        `${forbidden} в LinkPickerSheet — вторая копия шторки выбора клиента`,
      );
    }
  });

  test("круг связей не предлагается: дверь снимает обратную сторону", () => {
    const link = read("LinkPickerSheet.tsx");
    assert.match(
      link,
      /clientMemberships\(group\)\.map\(\(m\) => m\.group_id\)/,
      "дверь перестала считать обратные связи — Павел и Екатерина встанут друг у друга",
    );
    assert.match(link, /excludeIds=\{excludeIds\}/);
    assert.match(link, /excludeId=\{group\.id\}/, "шторка предлагает саму карточку");
    // Запрет должен не только приехать, но и сработать: шторка обязана
    // выкинуть этих людей из списка, а не просто принять проп.
    const picker = read("ClientPickerSheet.tsx");
    assert.match(
      picker,
      /!banned\.has\(c\.id\)/,
      "шторка принимает excludeIds и не фильтрует по ним",
    );
    assert.match(picker, /new Set\(excludeIds \?\? \[\]\)/);
  });

  test("курсор сразу в поиске — и проп доезжает до самого поля", () => {
    assert.match(read("LinkPickerSheet.tsx"), /\n\s+autoFocusSearch\n/);
    assert.match(
      read("ClientPickerSheet.tsx"),
      /autoFocus=\{autoFocusSearch\}/,
      "шторка связи объявляет автофокус, а поиску его не передаёт",
    );
    assert.match(
      read("../../components/ui/select-rows.tsx"),
      /autoFocus=\{autoFocus\}/,
      "общее поле поиска глотает автофокус",
    );
  });
});

describe("лист «Новый объект» закрывается после добавления", () => {
  test("добавили — лист уходит всегда, а форма пустеет только после записи", () => {
    const sheet = read("ObjectSheet.tsx");
    // Прогон 22.09: на карточке клиента лист оставался открытым с пустой
    // формой (ради трёх вилл подряд), и «Добавить объект» выглядел так, будто
    // ничего не сохранилось. Закрытие безусловное — и после `onAdded`, и без.
    const add = sheet.slice(sheet.indexOf("const add = async"), sheet.indexOf("return (\n    <BottomSheet"));
    assert.ok(add.length > 0, "не нашёл запись объекта в листе");
    assert.ok(!/if \(onAdded\) onClose\(\);/.test(add), "лист снова остаётся открытым на карточке клиента");
    assert.match(add, /\n      onClose\(\);\n      return true;/, "лист не закрывается после добавления");
    // Закрытие — только после подтверждённой записи: ранний выход по !id выше.
    assert.ok(add.indexOf("if (!id)") < add.indexOf("onClose();"), "лист закрывается раньше, чем запись подтвердилась");
    assert.match(add, /setDraft\(\(d\) => \(\{ \.\.\.EMPTY_DRAFT, type: d\.type \}\)\)/);
  });
});
