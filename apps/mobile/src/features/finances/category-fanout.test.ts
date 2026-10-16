import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { fanoutSummary, teamsMissingCategory } from "./category-fanout";

const cat = (team_id: string, name: string, type = "expense") => ({ team_id, type, name });

describe("«Во всех командах»: что ещё заводить", () => {
  test("обрыв на середине: повтор заводит только недостающее", () => {
    const existing = [cat("t1", "Топливо"), cat("t2", "Топливо")];
    assert.deepEqual(teamsMissingCategory(existing, ["t1", "t2", "t3", "t4"], "expense", "Топливо"), ["t3", "t4"]);
  });

  test("имя сравнивается без регистра и пробелов по краям, вид должен совпасть", () => {
    const existing = [cat("t1", "топливо "), cat("t2", "Топливо", "income")];
    assert.deepEqual(teamsMissingCategory(existing, ["t1", "t2"], "expense", " Топливо"), ["t2"]);
  });

  test("все уже есть — заводить нечего", () => {
    assert.deepEqual(teamsMissingCategory([cat("t1", "А")], ["t1"], "expense", "А"), []);
  });
});

describe("итог цикла по командам", () => {
  test("всё создано впервые — сказать нечего", () => {
    assert.equal(fanoutSummary({ created: 3, skipped: 0, total: 3, failed: false }), null);
  });

  test("часть уже была — итог с цифрами", () => {
    const s = fanoutSummary({ created: 2, skipped: 1, total: 3, failed: false });
    assert.equal(s?.title, "Категория создана");
    assert.match(s?.message ?? "", /Создана в 2 командах; в 1 команде она уже была/);
  });

  test("обрыв — честное «создано не везде» и подсказка повторить", () => {
    const s = fanoutSummary({ created: 1, skipped: 1, total: 4, failed: true });
    assert.equal(s?.title, "Создано не везде");
    assert.match(s?.message ?? "", /создана в 1 команде, ещё 2 не получилось/);
    assert.match(s?.message ?? "", /не задвоится/);
  });

  test("везде уже была — об этом и говорим", () => {
    assert.equal(fanoutSummary({ created: 0, skipped: 2, total: 2, failed: false })?.title, "Категория уже есть");
  });
});
