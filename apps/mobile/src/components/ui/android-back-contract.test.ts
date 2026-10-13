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

test("«Маршрут» в меню записи — шторка карт команды, а не Apple Карты в браузере", () => {
  const screen = read("../../../app/(dashboard)/(home)/index.tsx");
  assert.doesNotMatch(screen, /maps\.apple\.com/);
  assert.match(screen, /run: \(\) => route\.open\(null, address\)/);
  assert.match(screen, /\{route\.sheet\}/);
});

test("кнопки мессенджеров клиента не молчат, когда приложения нет", () => {
  const src = read("../../features/clients/PhoneChannelButton.tsx");
  assert.doesNotMatch(src, /void Linking\.openURL/);
  assert.match(src, /Linking\.openURL\(url\)\.catch\(\(\) =>\s*notify\(/);
});
