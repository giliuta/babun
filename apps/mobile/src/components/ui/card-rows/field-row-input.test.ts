import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  cleanFieldInput,
  fieldAutoCapitalize,
  fieldKeyboardTraits,
  initialFieldText,
  typedWithoutSeed,
} from "./field-row-input";

describe("FieldRow input rules", () => {
  test("money selects the whole number on focus, a phone number does not", () => {
    assert.deepEqual(fieldKeyboardTraits("decimal-pad"), { numericKeyboard: true, selectOnFocus: true });
    assert.deepEqual(fieldKeyboardTraits("numbers-and-punctuation"), {
      numericKeyboard: true,
      selectOnFocus: true,
    });
    assert.deepEqual(fieldKeyboardTraits("phone-pad"), { numericKeyboard: true, selectOnFocus: false });
    assert.deepEqual(fieldKeyboardTraits("default"), { numericKeyboard: false, selectOnFocus: false });
    assert.deepEqual(fieldKeyboardTraits(undefined), { numericKeyboard: false, selectOnFocus: false });
  });

  test("an empty autofocused field starts on the seed", () => {
    assert.equal(initialFieldText("", true, "+357 "), "+357 ");
    assert.equal(initialFieldText("", false, "+357 "), "");
    assert.equal(initialFieldText("", true, undefined), "");
    assert.equal(initialFieldText("99 123456", true, "+357 "), "99 123456");
  });

  test("a lone country code is not a number", () => {
    assert.equal(typedWithoutSeed(" +357 ", "+357 "), "");
    assert.equal(typedWithoutSeed("+357 99", "+357 "), "+357 99");
    assert.equal(typedWithoutSeed("  Anna  ", undefined), "Anna");
    assert.equal(typedWithoutSeed("", ""), "");
  });

  test("a phone field drops letters; other fields use their own sanitizer", () => {
    assert.equal(cleanFieldInput("+357 abc 99", "phone-pad", undefined), "+357  99");
    assert.equal(cleanFieldInput("ab1", "default", (v) => v.toUpperCase()), "AB1");
    assert.equal(cleanFieldInput("ab1", "phone-pad", (v) => v.toUpperCase()), "1");
    assert.equal(cleanFieldInput("ab1", undefined, undefined), "ab1");
  });
  test("a text row starts with a capital unless it says otherwise", () => {
    assert.equal(fieldAutoCapitalize(undefined, undefined), "sentences");
    assert.equal(fieldAutoCapitalize("default", undefined), "sentences");
    assert.equal(fieldAutoCapitalize(undefined, "words"), "words");
    assert.equal(fieldAutoCapitalize(undefined, "none"), "none");
    assert.equal(fieldAutoCapitalize("latin", undefined), undefined);
    assert.equal(fieldAutoCapitalize("email-address", undefined), undefined);
    assert.equal(fieldAutoCapitalize("phone-pad", undefined), undefined);
    assert.equal(fieldAutoCapitalize("latin", "characters"), "characters");
  });
});
