import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { docTitle } from "./appointment-files";

describe("блок «Файлы»", () => {
  test("docTitle", () => {
    assert.equal(docTitle("Акт выполненных работ.pdf"), "Акт выполненных работ");
    assert.equal(docTitle(".hidden"), ".hidden");
    assert.equal(docTitle("  "), "Документ");
  });
});
