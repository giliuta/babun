import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// ПОДСКАЗКА У СЕРОЙ КНОПКИ ВИДНА ПОВЕРХ ЛИСТА. Тост живёт в провайдере
// приложения, а лист — отдельное окно: «Назовите шаблон» всплывало под ним,
// и серая «Создать» выглядела просто мёртвой.

const here = dirname(fileURLToPath(import.meta.url));

test("лист шаблона показывает, что мешает сохранить, своей плашкой", () => {
  const source = readFileSync(resolve(here, "SmsTemplateSheet.tsx"), "utf8");
  assert.doesNotMatch(source, /toast\(problem/);
  assert.match(source, /banner=\{hint \? <NoticeBar tone="info" message=\{hint\} \/> : undefined\}/);
  assert.match(source, /onDisabledPress=\{[\s\S]{0,200}showHint\(problem\)/);
});
