import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// С12: правка текста адреса переносила поставленную рукой точку на находку
// геокодера — переезд карты за адресом отдавался как выбор точки.
const read = (file: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), file), "utf8");

describe("ручная точка на карте не уезжает за геокодером", () => {
  test("переезд за адресом снимает взвод на обеих платформах", () => {
    for (const file of ["MapPicker.web.tsx", "MapPicker.tsx"]) {
      assert.match(read(file), /if \(!follow \|\| !map(?:Ref)?\.current\) return;[\s\S]{0,400}armed\.current = false;/);
    }
  });

  test("с отмеченной точкой карта за адресом не едет", () => {
    assert.ok(read("object-fields/ObjectMapPanel.tsx").includes("follow={pinCoords ? null : follow}"));
  });
});
