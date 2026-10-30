import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { readModuleSource } from "@/lib/module-source";

// ОДИН ТАП — ОДНА ВИБРАЦИЯ. Тап по записи тикает в `openWithTick` блока, тап
// по «+N» — в самой карточке; день, открывающий список, второго тика не даёт.
const here = dirname(fileURLToPath(import.meta.url));
// Вход + его папка: тело дня и блока живёт в `day-view/` и `appointment-block/`.
const readParts = (entry: string, folder: string) =>
  readModuleSource(resolve(here, entry), resolve(here, folder));

test("«+N» открывается одним тиком — его даёт сама карточка", () => {
  const more = readFileSync(resolve(here, "day-view/MoreBlock.tsx"), "utf8");
  assert.equal(more.match(/haptics\./g)?.length, 1);
  assert.match(more, /onPress=\{\(\) => \{\s*haptics\.tap\(\);\s*onOpen\(card\);/);
  const day = readFileSync(resolve(here, "day-view/DayColumn.tsx"), "utf8");
  assert.match(day, /onOpen=\{setMoreOpen\}/);
  assert.doesNotMatch(day, /haptics\./);
  assert.match(readParts("AppointmentBlock.tsx", "appointment-block"), /const openWithTick = \(a: Appointment\) => \{\s*haptics\.tap\(\);\s*onEdit\(a\);/);
});
