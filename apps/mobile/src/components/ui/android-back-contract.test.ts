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

test("экраны над табами держат низ над навигацией Android — ровно один раз", () => {
  // Стек группы говорит экрану «ты над табами», а низ экран берёт сам: отступ
  // стека поверх удваивался у экранов, которые над табами и так берут низ.
  for (const f of ["../../../app/(shared)/_layout.tsx", "../../../app/invoices/_layout.tsx", "../../../app/documents/_layout.tsx"]) {
    const layout = read(f);
    assert.match(layout, /<OverTabs value>/, f);
    assert.doesNotMatch(layout, /insets\.bottom/, f);
  }
  const screen = read("Screen.tsx");
  assert.match(screen, /useContext\(OverTabsContext\) && Platform\.OS === "android"/);
  assert.match(screen, /edge === "bottom" && overTabs/);
});

test("корень вкладки «Офис» не берёт низ: его закрывает таб-бар", () => {
  assert.match(read("../../../app/(dashboard)/cabinet/index.tsx"), /<Screen edges=\{\["top"\]\}>/);
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

test("подъём над клавиатурой меряет рамку в координатах экрана, как и клавиатуру", () => {
  // `measureInWindow` на странице отсчитывает от низа строки состояния, а
  // `screenY` клавиатуры — от верха экрана: подъём недобирал ~52 dp, и подвал
  // страницы («Создать клиента», «Сохранить» записи) уходил под клавиатуру.
  const lift = read("KeyboardLift.tsx");
  assert.match(lift, /ref\.current\?\.measure\(\(_x, _y, _w, h, _pageX, pageY\) =>/);
  assert.match(lift, /pageY \+ h - kb\.screenY/);
  assert.doesNotMatch(lift, /ref\.current\?\.measureInWindow\(/);
});
