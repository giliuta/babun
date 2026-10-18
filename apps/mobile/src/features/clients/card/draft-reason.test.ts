import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { draftReasonOf } from "./draft-reason";

const base = {
  isDraft: true,
  duplicate: null,
  fullName: "Мария",
  e164: "+35799123456",
  draftPhoneTyped: true,
};

describe("draftReasonOf", () => {
  test("a saved card has no reason", () => {
    assert.equal(draftReasonOf({ ...base, isDraft: false, fullName: "" }), null);
  });

  test("a taken number wins over a missing name and names the owner", () => {
    assert.equal(
      draftReasonOf({ ...base, fullName: "", duplicate: { full_name: " Павел Иванов " } }),
      "Такой номер уже есть: Павел Иванов",
    );
    assert.equal(draftReasonOf({ ...base, duplicate: { full_name: "  " } }), "Такой номер уже есть");
  });

  test("then the name", () => {
    assert.equal(draftReasonOf({ ...base, fullName: "   " }), "Впишите имя");
  });

  test("a started but unparsed number asks to check it; no number at all is fine", () => {
    assert.equal(draftReasonOf({ ...base, e164: null }), "Проверьте номер и код страны");
    assert.equal(draftReasonOf({ ...base, e164: null, draftPhoneTyped: false }), null);
  });

  test("a complete draft has no reason", () => {
    assert.equal(draftReasonOf(base), null);
  });
});
