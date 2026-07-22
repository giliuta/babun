import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { csvCell, csvDocument, csvTextCell } from "./share-csv";

describe("safe regional CSV", () => {
  test("quotes delimiters, quotes and line breaks without losing content", () => {
    assert.equal(csvCell('A; "B"\nC'), '"A; ""B""\nC"');
    assert.equal(
      csvDocument([[csvCell("Имя"), csvCell("Заметка")], [csvCell("Иван"), csvCell("строка")]]),
      "\uFEFFИмя;Заметка\r\nИван;строка",
    );
  });

  test("neutralizes formula prefixes but leaves ordinary values unchanged", () => {
    assert.equal(csvTextCell("=1+1"), "'=1+1");
    assert.equal(csvTextCell(" +35799111222"), "' +35799111222");
    assert.equal(csvTextCell("\n@SUM(A1:A2)"), '"\'\n@SUM(A1:A2)"');
    assert.equal(csvTextCell("Лимасол"), "Лимасол");
    assert.equal(csvTextCell(""), "");
  });
});
