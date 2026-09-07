import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { docTitle, isVideoPath } from "./appointment-files";

describe("блок «Файлы»", () => {
  test("docTitle", () => {
    assert.equal(docTitle("Акт выполненных работ.pdf"), "Акт выполненных работ");
    assert.equal(docTitle(".hidden"), ".hidden");
    assert.equal(docTitle("  "), "Документ");
  });
  test("isVideoPath", () => {
    assert.equal(isVideoPath("t/a/1.mp4"), true);
    assert.equal(isVideoPath("t/a/1.MOV"), true);
    assert.equal(isVideoPath("t/a/1.jpg"), false);
  });
});
