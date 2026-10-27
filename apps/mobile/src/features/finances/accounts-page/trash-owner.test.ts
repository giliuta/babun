import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// «УДАЛЁННЫЕ СЧЕТА» — ТОЛЬКО ВЛАДЕЛЬЦУ (аудит 035, F-22): по прямой ссылке
// `/accounts/trash` партнёр видел список и «Вернуть». Экран — по исходнику.
const here = dirname(fileURLToPath(import.meta.url));
const route = readFileSync(resolve(here, "../../../../app/accounts/trash.tsx"), "utf8");

test("не владельцу — пустой экран со словами, без строк и «Вернуть»", () => {
  assert.match(route, /role !== undefined && role !== "owner" \? \(\s*<EmptyState fill title="Удалённые счета видит владелец" \/>/);
});

test("счёт архивного календаря не возвращается «невидимкой» (F-18)", () => {
  assert.match(route, /account\.brigade_id && archived\.has\(account\.brigade_id\)\s*\? toast\("Календарь этого счёта в архиве — сначала верните календарь", "info"\)/);
  assert.match(route, /archivedCalendarIds\(useTeams\(\{ includeInactive: true \}\)\.data \?\? \[\]\)/);
});
