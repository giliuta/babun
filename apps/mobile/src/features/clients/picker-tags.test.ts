import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { ClientTag } from "@babun/shared/local/clients";
import { tagsOfferedFor } from "./picker-tags";

// ШТОРКА ТЕГОВ КЛИЕНТА: что в ней предложено и когда сеется черновик.
// Экраны импортировать нельзя (за ними тянется react-native), поэтому
// проводка в шторку проверяется по исходнику, а правило выбора — напрямую.

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative: string) => readFileSync(resolve(here, relative), "utf8");

const tag = (id: string, team_id: string | null): ClientTag =>
  ({ id, name: id, color: "#000000", team_id }) as ClientTag;

describe("теги в шторке", () => {
  const catalog = [tag("own", "T1"), tag("common", null), tag("foreign", "T2"), tag("other", "T2")];

  test("предложены теги команды клиента и общие", () => {
    assert.deepEqual(tagsOfferedFor(catalog, "T1", []).map((t) => t.id), ["own", "common"]);
  });

  test("уже стоящий тег другой команды виден — его можно снять", () => {
    assert.deepEqual(
      tagsOfferedFor(catalog, "T1", ["foreign"]).map((t) => t.id),
      ["own", "common", "foreign"],
    );
  });

  test("клиент без команды — весь каталог", () => {
    assert.equal(tagsOfferedFor(catalog, null, []).length, catalog.length);
  });

  test("карточка отдаёт шторке именно этот набор", () => {
    const tiles = read("ClientLabelTags.tsx");
    assert.match(tiles, /tagsOfferedFor\(tags, client\.team_id \?\? null, shownTags\)/);
    assert.match(tiles, /tags=\{offeredTags\}/);
  });
});

describe("черновик шторки переживает поход в шестерёнку", () => {
  // Шестерёнка паркует шторку (`visible` ложно), а «назад» её поднимает.
  // Сеять черновик на каждый `visible` — значит стереть отметки, сделанные
  // до шестерёнки. Сеется только настоящее открытие.
  test("сеет по `open`, а не по `visible`", () => {
    const sheet = read("TagPickerSheet.tsx");
    assert.match(sheet, /const opened = open \?\? visible;/);
    assert.match(sheet, /if \(opened\) setDraft\(selected\);/);
    assert.match(sheet, /\}, \[opened\]\);/);
  });
  test("карточка отдаёт открытие отдельно от парковки", () => {
    const tiles = read("ClientLabelTags.tsx");
    assert.match(tiles, /visible=\{tagsOpen && !doorway\.parked\}\s*open=\{tagsOpen\}/);
  });
});
