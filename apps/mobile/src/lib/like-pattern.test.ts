import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { containsPattern } from "./like-pattern";

describe("containsPattern", () => {
  test("обычный текст — «содержит»", () => {
    assert.equal(containsPattern("фреон"), "%фреон%");
  });
  test("% и _ ищутся буквально", () => {
    assert.equal(containsPattern("50%"), "%50\\%%");
    assert.equal(containsPattern("a_b"), "%a\\_b%");
  });
  test("обратная косая тоже буквально", () => {
    assert.equal(containsPattern("a\\b"), "%a\\\\b%");
  });
});
