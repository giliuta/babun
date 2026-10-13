import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// ОДИН ТАП — ОДНА ВИБРАЦИЯ (13.10). Тап по стопке записей шёл через
// `openWithTick` блока (тик) и `openDeck` дня (ещё тик) — двойная вибрация.
const here = dirname(fileURLToPath(import.meta.url));
const read = (f: string) => readFileSync(resolve(here, f), "utf8");

test("стопка открывается без второго тика — его уже дал блок", () => {
  const day = read("DayView.tsx");
  const open = day.slice(day.indexOf("const openDeck ="), day.indexOf("setDeckOpen(deck.members);"));
  assert.ok(open.length > 0);
  assert.doesNotMatch(open, /haptics\./);
  assert.match(read("AppointmentBlock.tsx"), /const openWithTick = \(a: Appointment\) => \{\s*haptics\.tap\(\);\s*onEdit\(a\);/);
});
