import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { businessFormFromTenant, shouldReseedBusinessForm } from "./business-form";

describe("«Личная информация»: пересев формы из профиля", () => {
  test("перечитанный профиль той же компании не стирает набранное", () => {
    // Логотип пишется сразу и сбрасывает кэш профиля — приходит тот же id.
    assert.equal(shouldReseedBusinessForm("t1", "t1", true), false);
  });

  test("чистая форма и смена компании пересеваются", () => {
    assert.equal(shouldReseedBusinessForm("t1", "t1", false), true);
    assert.equal(shouldReseedBusinessForm("t1", "t2", true), true);
    assert.equal(shouldReseedBusinessForm(null, "t1", false), true);
  });

  test("пустые поля профиля становятся пустыми строками", () => {
    const form = businessFormFromTenant({ id: "t1", name: "AirFix", iban: null });
    assert.equal(form.name, "AirFix");
    assert.equal(form.iban, "");
    assert.equal(form.city, "");
  });

  test("экран пересевает форму только через правило, а не на каждый профиль", () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../../app/(dashboard)/cabinet/business.tsx"),
      "utf8",
    );
    assert.match(src, /shouldReseedBusinessForm\(/);
  });
});
