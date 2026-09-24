import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { templatesForSheet } from "./template-apply";

const tpl = (name: string, brigade_id: string | null) => ({ name, brigade_id });

describe("шаблоны в форме операции", () => {
  test("своя команда и шаблоны без команды, по алфавиту", () => {
    const list = [
      tpl("Связь", "t-1"),
      tpl("аренда", null),
      tpl("Топливо", "t-2"),
      tpl("Бензин", "t-1"),
    ];
    assert.deepEqual(
      templatesForSheet(list, "t-1").map((x) => x.name),
      ["аренда", "Бензин", "Связь"],
    );
  });

  test("шаблон чужой команды не предлагается", () => {
    assert.deepEqual(templatesForSheet([tpl("Топливо", "t-2")], "t-1"), []);
  });

  test("команда не выбрана — предлагать нечего", () => {
    assert.deepEqual(templatesForSheet([tpl("аренда", null)], null), []);
  });
});
