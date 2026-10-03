import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { moreLabel } from "./more-label";

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative: string) => readFileSync(resolve(here, relative), "utf8");

describe("«Ещё N» в шапке блока карточки (03.10)", () => {
  test("одна вещь — плашки нет; больше — сколько ещё", () => {
    assert.equal(moreLabel(0), null);
    assert.equal(moreLabel(1), null);
    assert.equal(moreLabel(3), "Ещё 2");
    assert.equal(moreLabel(12), "Ещё 11");
  });

  test("плашка стоит у «Истории», «Объектов», «Файлов» и «Реквизитов»", () => {
    for (const file of ["ClientContactRow.tsx", "blocks/ObjectsBlock.tsx", "blocks/ClientFilesBlock.tsx", "blocks/RequisitesBlock.tsx"]) {
      assert.match(read(file), /pill: true/, `${file}: нет плашки «Ещё N»`);
      assert.match(read(file), /moreLabel\(/, `${file}: счёт не по общему правилу`);
    }
  });
});

describe("блок «SMS» — мини-история в самом блоке (03.10)", () => {
  const block = () => read("../sms/SmsClientBlock.tsx");
  test("настройки — на блоке; три последних — плашками; тап — само сообщение", () => {
    // С 03.10 — плашки со значком (вариант 1 владельца), имя — в сером поле.
    assert.match(block(), /title="Присылать SMS"/);
    assert.match(block(), /title="Имя для SMS"/);
    assert.match(block(), /onBlur=\{saveName\}/);
    assert.match(block(), /const MINI_HISTORY = 3;/);
    assert.match(block(), /<SmsPlaque[\s\S]{0,400}onPress=\{\(\) => setOpen\(item\)\}/);
    assert.match(block(), /<SmsMessageSheet/);
  });
  test("страница — только когда сообщений больше трёх, через «Ещё N»", () => {
    assert.match(block(), /const more = moreLabel\(messages\.length, recent\.length\);/);
    assert.match(block(), /label: more, pill: true, onPress: openAll/);
    assert.match(block(), /pathname: "\/clients\/sms", params: clientSubParams\(client\.id, scope\)/);
  });
  test("отправки в блоке нет — только у трубки клиента", () => {
    // Ищется КНОПКА, а не слово: почему её нет, сказано в комментарии.
    assert.doesNotMatch(block(), /label="Отправить/);
    assert.doesNotMatch(read("../../../app/(dashboard)/clients/sms.tsx"), /<GradientButton|label="Отправить/);
  });
});
