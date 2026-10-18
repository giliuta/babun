import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ImportableField } from "../csv-mapping";
import {
  fileProblem,
  MAX_BYTES,
  previewReasonParts,
  progressPct,
  rowsProblem,
  withColumn,
} from "./wizard-rules";

describe("fileProblem", () => {
  test("too big a file is refused first", () => {
    assert.equal(fileProblem("a.xlsx", MAX_BYTES + 1), "Файл больше 10 МБ — пересохрани как CSV без лишних колонок.");
  });
  test("only .csv and .txt, any case", () => {
    assert.equal(fileProblem("Клиенты.CSV", 10), null);
    assert.equal(fileProblem("list.txt", undefined), null);
    assert.equal(fileProblem("list.xlsx", 10), "Только .csv или .txt файлы.");
  });
});

describe("rowsProblem", () => {
  test("empty, within limit, over limit", () => {
    assert.equal(rowsProblem(0), "Файл пустой или нет строк данных (только заголовок).");
    assert.equal(rowsProblem(5000), null);
    assert.equal(rowsProblem(5001), "Слишком много строк (5001). Максимум 5000 за раз — раздели файл на части.");
  });
});

describe("withColumn", () => {
  test("a field moves to the new column and leaves the old one", () => {
    const before: ImportableField[] = ["full_name", "phone", "skip"];
    assert.deepEqual(withColumn(before, 2, "phone"), ["full_name", "skip", "phone"]);
    assert.deepEqual(before, ["full_name", "phone", "skip"], "input untouched");
  });
  test("skip may repeat", () => {
    assert.deepEqual(withColumn(["skip", "phone"], 1, "skip"), ["skip", "skip"]);
  });
});

describe("previewReasonParts", () => {
  test("only non-zero reasons, in fixed order", () => {
    assert.deepEqual(previewReasonParts({ emptyName: 0, badPhone: 2, duplicateInFile: 1, duplicateInDb: 3 }), [
      "2 битый телефон",
      "1 дубл. в файле",
      "3 уже в базе",
    ]);
  });
});

describe("progressPct", () => {
  test("no progress yet, part, all", () => {
    assert.equal(progressPct(null), 0);
    assert.equal(progressPct({ done: 0, total: 0 }), 0);
    assert.equal(progressPct({ done: 1, total: 3 }), 33);
    assert.equal(progressPct({ done: 3, total: 3 }), 100);
  });
});
