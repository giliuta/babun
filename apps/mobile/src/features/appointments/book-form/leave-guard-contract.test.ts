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
