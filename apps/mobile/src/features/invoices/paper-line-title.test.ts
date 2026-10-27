import { describe, it as test } from "node:test";
import assert from "node:assert/strict";
import { paperLineTitle } from "./generator-settings";

describe("paperLineTitle", () => {
  test("дефолт колонки «Услуги» печатается на языке бумаги", () => {
    assert.equal(paperLineTitle("Услуги", "en"), "Services");
    assert.equal(paperLineTitle("Услуги", "el"), "Υπηρεσίες");
    assert.equal(paperLineTitle("Услуги", "ru"), "Услуги");
    assert.equal(paperLineTitle("  ", "de"), "Dienstleistungen");
  });

  test("своё название компании не переводится", () => {
    assert.equal(paperLineTitle("Выездные работы", "en"), "Выездные работы");
  });
});
