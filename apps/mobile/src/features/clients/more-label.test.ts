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
