import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ВЫХОДНОЙ — СЛУЖЕБНАЯ ОТМЕТКА, А НЕ МЕТКА (находка владельца №9, 28.10).
// Точка выходного в Месяце и корешок «Вых» красились `danger` и путались с
// красной меткой дня (Limassol #E8145D против #C9372C). Цвет отдан меткам —
// их выбирает человек; выходной говорит словом и нейтральной краской.
// Красные СБ/ВС в шапке — государственные выходные, их это правило не
// касается.

const src = (path: string) => readFileSync(join(__dirname, "..", "..", "..", path), "utf8");

describe("выходной без пигмента", () => {
  test("корешок «Вых» — служебный LabelTag без цвета", () => {
    for (const file of [
      "src/features/calendar/date-header.tsx",
      "src/features/reference/WeekProjection.tsx",
    ]) {
      const s = src(file);
      assert.doesNotMatch(s, /<LabelTag color=\{t\.danger\}/, file);
      assert.match(s, /<LabelTag color=\{null\} text="Вых/, file);
    }
  });

  test("точка выходного в Месяце — нейтральная", () => {
    const s = src("src/features/calendar/MonthView.tsx");
    assert.match(s, /backgroundColor: dayOff \? t\.chevron : label\?\.color/);
  });

  test("служебный корешок держит форму токенами, не пигментом", () => {
    const s = src("src/components/ui/LabelTag.tsx");
    assert.match(s, /color \? `\$\{color\}29` : t\.rowFillPressed/);
    assert.match(s, /color \? `\$\{color\}8c` : t\.separatorStrong/);
  });
});
