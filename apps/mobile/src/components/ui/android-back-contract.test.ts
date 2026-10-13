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

test("экраны над табами (`(shared)`) не прячут подвал под навигацию Android", () => {
  const layout = read("../../../app/(shared)/_layout.tsx");
  assert.match(layout, /paddingBottom: Platform\.OS === "android" \? insets\.bottom : 0/);
});

test("инвойсы и чеки над табами тоже держат отступ навигации Android", () => {
  for (const f of ["../../../app/invoices/_layout.tsx", "../../../app/documents/_layout.tsx"]) {
    assert.match(read(f), /paddingBottom: Platform\.OS === "android" \? insets\.bottom : 0/, f);
  }
});

test("«Назад» выходит из режима корневой вкладки, а не сворачивает приложение", () => {
  // Перенос записи и «Записать: …» — плашка режима; выбор — список клиентов.
  assert.match(read("../../features/calendar/ModePlaque.tsx"), /useAndroidBack\(true, onExit\);/);
  assert.match(read("../../../app/(dashboard)/clients/index.tsx"), /useAndroidBack\(selecting, exitSelection\);/);
  // Только пока экран в фокусе: форма записи поверх календаря в режиме
  // «Записать» закрывается своим «назад», а не гасит режим под собой.
  const hook = read("../../lib/android-back.ts");
  assert.match(hook, /useFocusEffect\(/);
  assert.match(hook, /if \(!active\) return undefined;/);
  assert.match(hook, /return true;/);
});
