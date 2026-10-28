import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// ПРОМАХ НА НАЗВАНИЕ НЕ СНИМАЕТ УСЛУГУ. Компоненты тянут react-native и под
// раннером не поднимаются — проверка идёт по исходнику.

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(here, rel), "utf8");

test("тап по строке берёт услугу, выбранную не снимает", () => {
  const picker = read("../BookingPickers.tsx");
  assert.match(picker, /const take = \(id: string\) => \{\s*if \(selectedIds\.includes\(id\)\) return;/);
  assert.match(picker, /onPress=\{\(\) => take\(s\.id\)\}/);
  assert.match(picker, /onRemove=\{\(\) => onToggle\(s\.id\)\}/);
});

test("«−» на единице снимает услугу", () => {
  const qty = read("PickerQty.tsx");
  assert.match(qty, /if \(qty \+ delta < 1\) onRemove\(\);\s*else onChange\(qty \+ delta\);/);
  assert.match(qty, /step\(-1, qty <= 1 \? `Убрать: \$\{name\}` : `Убавить: \$\{name\}`, "\\u2212"\)/);
});
