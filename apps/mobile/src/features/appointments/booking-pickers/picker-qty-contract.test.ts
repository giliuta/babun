import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// ПРОМАХ НА НАЗВАНИЕ НЕ СНИМАЕТ УСЛУГУ. Компоненты тянут react-native и под
// раннером не поднимаются — проверка идёт по исходнику.

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(here, rel), "utf8");

test("строка не нажимается: количество — только «−» и «+»", () => {
  const picker = read("../BookingPickers.tsx");
  const row = picker.slice(picker.indexOf("<SelectRow"), picker.indexOf("/>", picker.indexOf("<PickerQty")));
  assert.doesNotMatch(row, /onPress=/, "строка выбора услуги снова берёт услугу по тапу");
  // Степпер стоит у каждой строки, у невзятой — с нулём.
  assert.match(row, /qty=\{on \? \(qty \?\? 1\) : 0\}/);
  assert.match(row, /onChange=\{\(next\) => \(on \? onQtyChange\(s\.id, next\) : take\(s\.id\)\)\}/);
  assert.match(row, /onRemove=\{\(\) => onToggle\(s\.id\)\}/);
  assert.match(picker, /const take = \(id: string\) => \{\s*if \(selectedIds\.includes\(id\)\) return;/);
});

test("«−» на единице снимает услугу, на нуле гаснет", () => {
  const qty = read("PickerQty.tsx");
  assert.match(qty, /if \(qty \+ delta < 1\) onRemove\(\);\s*else onChange\(qty \+ delta\);/);
  assert.match(qty, /step\(-1, qty <= 1 \? `Убрать: \$\{name\}` : `Убавить: \$\{name\}`, "\\u2212", qty < 1\)/);
});

test("строка без нажатия не гасит вид и не прячет кнопки от VoiceOver", () => {
  const rows = read("../../../components/ui/select-rows.tsx");
  assert.match(rows, /onPress\?: \(\) => void;/);
  assert.match(rows, /disabled=\{disabled \|\| \(!onPress && !onLongPress\)\}/);
  assert.match(rows, /accessible=\{onPress \|\| onLongPress \? undefined : false\}/);
  assert.match(rows, /opacity: disabled \? 0\.4 : 1/);
});
