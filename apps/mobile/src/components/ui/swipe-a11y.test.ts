import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { SWIPE_LEADING, SWIPE_TRAILING, mergeSwipeActions } from "./swipe-a11y";

// СВАЙП ДОСТУПЕН ROTOR'У. Для VoiceOver свайпа не существует: «Удалить»,
// жившее только на кромке, было недостижимо. Строка сама получает действия
// своих кромок — и не теряет те, что уже объявила сама.

describe("действия кромок для VoiceOver", () => {
  test("обе кромки становятся действиями строки: сначала левая, потом «Удалить»", () => {
    assert.deepEqual(mergeSwipeActions(undefined, { leading: "Скрыть", trailing: "Удалить" }), [
      { name: SWIPE_LEADING, label: "Скрыть" },
      { name: SWIPE_TRAILING, label: "Удалить" },
    ]);
  });

  test("свои действия строки сохраняются, совпавшее по слову не дублируется", () => {
    const own = [
      { name: "restore", label: "Вернуть" },
      { name: "erase", label: "Удалить насовсем" },
    ];
    assert.deepEqual(mergeSwipeActions(own, { leading: "Вернуть", trailing: "Удалить" }), [
      { name: "restore", label: "Вернуть" },
      { name: "erase", label: "Удалить насовсем" },
      { name: SWIPE_TRAILING, label: "Удалить" },
    ]);
  });

  test("нет кромки — нет и действия", () => {
    assert.deepEqual(mergeSwipeActions(undefined, {}), []);
  });

  test("SwipeRow вешает действия на саму строку и разводит их по обработчикам", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const row = readFileSync(resolve(here, "SwipeRow.tsx"), "utf8");
    assert.match(row, /cloneElement\(/);
    assert.match(row, /mergeSwipeActions\(/);
    assert.match(row, /=== SWIPE_TRAILING\) fire\(\);/);
    assert.match(row, /=== SWIPE_LEADING\) fireLead\(\);/);
    // Своё действие строки уходит её собственному обработчику, а не теряется.
    assert.match(row, /else own\.onAccessibilityAction\?\.\(event\);/);
  });
});
