import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { docTitle, docsWord, filesCaption, photoTag } from "./appointment-files";

describe("блок «Файлы»", () => {
  test("docsWord склоняет", () => {
    assert.equal(docsWord(1), "1 документ");
    assert.equal(docsWord(2), "2 документа");
    assert.equal(docsWord(5), "5 документов");
    assert.equal(docsWord(11), "11 документов");
    assert.equal(docsWord(21), "21 документ");
  });
  test("filesCaption", () => {
    assert.deepEqual(filesCaption(0, 0), { text: "Нет файлов", empty: true });
    assert.deepEqual(filesCaption(3, 0), { text: "3 фото", empty: false });
    assert.deepEqual(filesCaption(3, 1), { text: "3 фото · 1 документ", empty: false });
    assert.deepEqual(filesCaption(0, 2), { text: "2 документа", empty: false });
  });
  test("photoTag и docTitle", () => {
    assert.equal(photoTag("before"), "До");
    assert.equal(photoTag("after"), "После");
    assert.equal(photoTag("other"), null);
    assert.equal(docTitle("Акт выполненных работ.pdf"), "Акт выполненных работ");
    assert.equal(docTitle(".hidden"), ".hidden");
    assert.equal(docTitle("  "), "Документ");
  });
});
