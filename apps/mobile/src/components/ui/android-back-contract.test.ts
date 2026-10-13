import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// «НАЗАД» ANDROID (13.10, проверено на эмуляторе Android 16).
const read = (f: string) => readFileSync(join(__dirname, f), "utf8");

test("«Назад» сначала закрывает вопрос поверх листа, а не весь лист", () => {
  const sheet = read("BottomSheet.tsx");
  assert.match(sheet, /const back = overlayBackFor\(sheetId\);\s*if \(back\) back\(\);\s*else onClose\(\);/);
  assert.match(sheet, /<OverlayLayers target=\{target\.current as string\} layers=\{layers\} onBack=\{onClose\} \/>/);
  assert.match(read("sheet-overlay.tsx"), /export function overlayBackFor\(id: string\)/);
});

test("«Назад» не закрывает мастер импорта, пока идёт импорт", () => {
  const wizard = read("../../features/clients/import/ImportWizardSheet.tsx");
  assert.match(wizard, /onRequestClose=\{\(\) => \{\s*if \(!\(importer\.isPending \|\| preparing\)\) close\(\);/);
});
