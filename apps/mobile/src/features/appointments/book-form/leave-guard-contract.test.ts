import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// ОТКРЫЛ И ЗАКРЫЛ — НИКАКИХ ВОПРОСОВ. Хуки формы тянут react-native и под
// раннером не поднимаются — проверка идёт по исходнику.

const here = dirname(fileURLToPath(import.meta.url));
const draft = readFileSync(resolve(here, "use-book-draft.ts"), "utf8");

test("заметка записи кладётся в ссылку сразу при загрузке записи", () => {
  // Снимок «как было» читает заметку из `commentNow` в том же коммите, что и
  // загрузка. Эффект, догоняющий ссылку кадром позже, давал пустой снимок —
  // и запись с заметкой на «Назад» спрашивала «Сохранить изменения?».
  const hydrate = draft.slice(draft.indexOf('if (editing.kind === "work") {'));
  const branch = hydrate.slice(0, hydrate.indexOf("} else {"));
  assert.match(branch, /commentNow\.current = editing\.comment/);
});

test("Android: «назад» с формы без истории — стрелка формы, а не выход из приложения", () => {
  // После пересоздания активности запись — единственный экран стека, и
  // системный жест сворачивал приложение вместе с набранным (QAA-11).
  const guard = readFileSync(resolve(here, "use-leave-guard.ts"), "utf8");
  assert.match(guard, /useAndroidBack\(!leaving && !router\.canGoBack\(\), requestClose\);/);
  assert.match(guard, /else router\.replace\("\/"\);/);
});

test("вопрос у несохраняемой формы называет, чего не хватает (CAL-11)", () => {
  const guard = readFileSync(resolve(here, "use-leave-guard.ts"), "utf8");
  assert.match(guard, /message: why \? `\$\{why\}\. \$\{lost\}` : lost/);
  const form = readFileSync(resolve(here, "use-book-form.ts"), "utf8");
  assert.match(form, /missingHint: verdict\.canSave \? undefined : verdict\.missingHint,/);
});

test("«Копировать» из «⋯» с несохранённым — вопрос, потом копия, а не календарь (CAL-22)", () => {
  // Переход в копию перехватывала защита формы, и «Сохранить» из её вопроса
  // уводил назад: копия создана, человек — в календаре.
  const guard = readFileSync(resolve(here, "use-leave-guard.ts"), "utf8");
  assert.match(guard, /const next = nextRef\.current;\s*nextRef\.current = null;\s*if \(next\) \{\s*next\(\);\s*return;/);
  // Несохранившееся «Сохранить» не оставляет продолжение следующему.
  assert.match(guard, /if \(!leavingRef\.current\) nextRef\.current = null;/);
  const menu = readFileSync(resolve(here, "use-record-menu.ts"), "utf8");
  assert.match(menu, /leaveThen\(\(saved\) => copyNow\(saved \? \{ \.\.\.source, \.\.\.saved \} : source\)\)/);
});

test("копия события на весь день — форма нового, запись только на «Создать» (CAL-33)", () => {
  // Копия создавалась до формы: вышел, не меняя дня, — дубль в том же дне.
  const quick = readFileSync(resolve(here, "../../calendar/home/use-quick-events.ts"), "utf8");
  const copyInPlace = quick.slice(quick.indexOf("const copyInPlace"));
  assert.doesNotMatch(copyInPlace.slice(0, copyInPlace.indexOf("};")), /createAppt/);
  assert.match(copyInPlace, /params: \{ copyOf: source, kind: "event"/);
  const prefill = readFileSync(resolve(here, "use-book-prefill.ts"), "utf8");
  assert.match(prefill, /hydrate\(\{ \.\.\.duplicateAppointment\(copySource\)/);
});

test("эталон правки — вид при открытии на сегодняшних справочниках, а не снимок кадра (№17)", () => {
  const guard = readFileSync(resolve(here, "use-leave-guard.ts"), "utf8");
  // Одноразового снимка по `hydrated` больше нет: справочники доезжали позже.
  assert.doesNotMatch(guard, /editBaselineRef\.current = editSignature/);
  assert.match(guard, /editBaselineRef\.current = moved \? withBaselineStatus\(baselineSignature, moved\) : baselineSignature;/);
  const form = readFileSync(resolve(here, "use-book-form.ts"), "utf8");
  // Состояние открытия снимается ДО подъёма прерванной правки.
  assert.ok(form.indexOf("setOpenRecord(") < form.indexOf("useRestoreEditDraft({"));
  assert.match(form, /openRecordPatch\(openRecord, \{/);
});
