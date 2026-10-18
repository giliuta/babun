import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { readModuleSource } from "@/lib/module-source";
import { orderMovable } from "./block-order";
import { bookFormSource } from "./book-form/source-for-tests";

// ПОРЯДОК БЛОКОВ ЗАПИСИ И СОБЫТИЯ: человек сам ставит, например, объект первым,
// клиента вторым.
//
const here = dirname(fileURLToPath(import.meta.url));
const prefs = readModuleSource(resolve(here, "booking-prefs.ts"));

const RECORD = ["client", "object", "services", "payment", "note", "files"];

describe("порядок подвижных блоков", () => {
  test("ничего не меняли — заводской порядок", () => {
    assert.deepEqual(orderMovable(RECORD, null), RECORD);
    assert.deepEqual(orderMovable(RECORD, []), RECORD);
  });

  test("случай брата: объект первым, клиент вторым", () => {
    const stored = ["object", "client", "services", "payment", "note", "files"];
    assert.deepEqual(orderMovable(RECORD, stored), stored);
  });

  test("чужие имена и повторы пропускаются", () => {
    assert.deepEqual(
      orderMovable(RECORD, ["object", "ghost", "client", "object", "services", "payment", "note", "files"]),
      ["object", "client", "services", "payment", "note", "files"],
    );
  });

  test("блок, которого нет в сохранённом, встаёт за своим заводским соседом", () => {
    assert.deepEqual(
      orderMovable(RECORD, ["object", "client", "services", "note", "files"]),
      ["object", "client", "services", "payment", "note", "files"],
    );
    assert.deepEqual(orderMovable(RECORD, ["files", "note"]).slice(0, 1), ["client"]);
  });
});

describe("форма и настройка читают один порядок", () => {
  // The booking form is the route plus `book-form/`.
  const form = bookFormSource();
  const design = readFileSync(resolve(here, "../calendar/design/DesignScreen.tsx"), "utf8");

  test("тело записи и события — по порядку команды", () => {
    assert.match(form, /\{inOrder\(blocks, \{\s*(\{\/\*[\s\S]*?\*\/\}\s*)?client: \(/);
    assert.match(form, /\{inOrder\(eventBlocks, \{\s*type: \(/);
    for (const id of ["client", "object", "services", "payment", "note", "files"]) {
      // Keys of the record body's map, at its indentation in `book-form/WorkBody.tsx`.
      assert.match(form, new RegExp(`\\n {8}${id}: \\(\\n {10}<>`), `нет блока ${id} в записи`);
    }
  });

  test("порядок хранится у команды и тянется за ручку", () => {
    assert.match(prefs, /next: \{ \.\.\.base, recordOrder: ids \}/);
    assert.match(prefs, /next: \{ \.\.\.base, eventOrder: ids \}/);
    assert.match(design, /onReorder=\{\(ids\) => recordOrder\.mutate\(ids, \{ onError: saveOrderError \}\)\}/);
    assert.match(design, /onReorder=\{\(ids\) => eventOrder\.mutate\(ids, \{ onError: saveOrderError \}\)\}/);
  });

  test("заметка записи и события — свой блок в три строки", () => {
    assert.equal(form.match(/rows=\{3\}/g)?.length, 2);
  });
});
