import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { nameInComment } from "./client-stats";

// Границы слова для привязки старых записей (client_id=null) к клиенту
// по имени в комментарии. Оба аргумента уже нормализованы (lowercase,
// схлопнутые пробелы) вызывающей стороной.
describe("nameInComment", () => {
  test("matches the name as a whole phrase inside longer text", () => {
    assert.equal(nameInComment("иван петров, сплит 12", "иван петров"), true);
    assert.equal(nameInComment("оплата — анна", "анна"), true);
    assert.equal(nameInComment("мария", "мария"), true);
  });

  test("does NOT match a short name as a substring of another word", () => {
    // Главный баг: «Ан» ловил «диван», «Иван» ловил «Иванов».
    assert.equal(nameInComment("починили диван", "ан"), false);
    assert.equal(nameInComment("иванов сергей", "иван"), false);
    assert.equal(nameInComment("кондиционер", "дицион"), false);
  });

  test("empty name never matches", () => {
    assert.equal(nameInComment("любой текст", ""), false);
  });
});
