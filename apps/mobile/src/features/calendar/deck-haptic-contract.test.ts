import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { readModuleSource } from "@/lib/module-source";

// ОДИН ТАП — ОДНА ВИБРАЦИЯ. Тап по стопке записей не должен идти и через
// `openWithTick` блока (тик), и через `openDeck` дня (ещё тик) — выйдет двойная вибрация.
const here = dirname(fileURLToPath(import.meta.url));
// Вход + его папка: тело дня и блока живёт в `day-view/` и `appointment-block/`.
const readParts = (entry: string, folder: string) =>
  readModuleSource(resolve(here, entry), resolve(here, folder));

test("стопка открывается без второго тика — его уже дал блок", () => {
  const day = readParts("DayView.tsx", "day-view");
  const open = day.slice(day.indexOf("const openDeck ="), day.indexOf("setDeckOpen(deck.members);"));
  assert.ok(open.length > 0);
  assert.doesNotMatch(open, /haptics\./);
  assert.match(readParts("AppointmentBlock.tsx", "appointment-block"), /const openWithTick = \(a: Appointment\) => \{\s*haptics\.tap\(\);\s*onEdit\(a\);/);
});
