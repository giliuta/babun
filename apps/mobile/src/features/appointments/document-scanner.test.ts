import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { pagesHtml, scanFileName } from "./scan-pdf";

describe("сканер документов — чистые части", () => {
  test("pagesHtml: страница на каждый скан, картинка вписана", () => {
    const html = pagesHtml(["AAA", "BBB"]);
    assert.equal((html.match(/page-break-after:always/g) ?? []).length, 2);
    assert.match(html, /data:image\/jpeg;base64,AAA/);
    assert.match(html, /object-fit:contain/);
  });
  test("scanFileName: дата и время без точек в расширении", () => {
    assert.equal(scanFileName(new Date(2026, 8, 6, 18, 7)), "Скан 06.09 18-07.pdf");
  });
});
