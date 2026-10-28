import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LIST_ROW } from "@/components/ui/tokens";

// СТРОКА СПИСКА — ОДНА РОЛЬ (владелец выбрал 15 / 13 / 52). Эталон —
// шторка выбора `SelectRow`; остальные списки берут `LIST_ROW`, а не числа.
// Новый список встаёт сюда, как только переведён на `LIST_ROW`.

const src = (path: string) => readFileSync(join(__dirname, "..", "..", path), "utf8");

const ROW_FILES = [
  "src/features/calendar/agenda/AgendaRow.tsx",
  "src/features/calendar/agenda/EventRow.tsx",
  "src/features/access/PeopleRows.tsx",
  "app/(dashboard)/cabinet/people/index.tsx",
  "src/features/services/price-list/ServicePriceRow.tsx",
  "src/features/clients/ClientRow.tsx",
];

describe("строка списка", () => {
  test("роль — 15/600 имя, 13 подпись, 52 высота", () => {
    assert.deepEqual(
      { name: LIST_ROW.name.fontSize, weight: LIST_ROW.name.fontWeight, sub: LIST_ROW.sub.fontSize, h: LIST_ROW.minHeight },
      { name: 15, weight: "600", sub: 13, h: 52 },
    );
  });

  test("эталонная шторка выбора набрана теми же числами", () => {
    const row = src("src/components/ui/select-rows.tsx");
    assert.match(row, /minHeight: 52/);
    assert.match(row, /fontSize: 15, fontWeight: "600", color: t\.ink/);
    assert.match(row, /fontSize: 13, color: t\.sub/);
  });

  for (const file of ROW_FILES) {
    test(`${file} берёт роль, а не свои кегли`, () => {
      const text = src(file);
      assert.match(text, /\.\.\.LIST_ROW\.name/);
      assert.match(text, /\.\.\.LIST_ROW\.sub/);
      // Прежние кегли имени и подписи строки — 16/600, 14/600 и 14 — уйти
      // обратно не должны.
      assert.doesNotMatch(text, /fontSize: 16, fontWeight: "600"/);
      assert.doesNotMatch(text, /fontSize: 14, fontWeight: "600", color: t\.ink/);
    });
  }
});
