import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { PhoneEntry } from "@babun/shared/local/clients";
import { EXTRA_LABELS, nextExtraLabel } from "./extra-labels";

const phone = (label: string): PhoneEntry => ({ id: label, number: "", label });

describe("nextExtraLabel", () => {
  test("takes the first standard label not used yet", () => {
    assert.equal(nextExtraLabel([]), "Мобильный");
    assert.equal(nextExtraLabel([phone("Мобильный")]), "Рабочий");
    assert.equal(nextExtraLabel([phone("Рабочий"), phone("Мобильный")]), "Домашний");
  });

  test("all standard labels used — «Другой»", () => {
    assert.equal(nextExtraLabel(EXTRA_LABELS.map(phone)), "Другой");
  });
});
