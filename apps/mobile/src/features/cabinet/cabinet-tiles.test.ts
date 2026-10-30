import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { SETTINGS_ROW_INSET } from "@/components/ui/tokens";

// КОРЕНЬ КАБИНЕТА — ОДИН МАТЕРИАЛ ПЛИТКИ.
//
// Нейтральная плитка (голый глиф в боксе 20) — только для денежных экранов
// (канон `SettingsRow`). В корне Кабинета пять строк жили нейтральными среди
// цветных: текст начинался на 8 pt левее соседей, и разделители — то по
// тексту, то мимо. Все строки — пигменты `SETTINGS_TILE`, разделитель — от
// текста цветной строки: поле 16 + плитка 28 + зазор 12 = 56.

const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string): string => readFileSync(resolve(here, path), "utf8");

const ROOT = [
  "../../../app/(dashboard)/cabinet/index.tsx",
  "./OwnAccountSection.tsx",
  "./InvitedAccounts.tsx",
  "./ArchiveRow.tsx",
  "./AboutRow.tsx",
  "./HelpRow.tsx",
  "./NotificationsRow.tsx",
  "./LanguageRow.tsx",
  "./HistoryRow.tsx",
];

describe("корень Кабинета", () => {
  test("ни одной нейтральной плитки", () => {
    for (const file of ROOT) {
      const source = read(file);
      assert.ok(/tile=\{SETTINGS_TILE\.\w+\}/.test(source) || !/<SettingsRow/.test(source), file);
      assert.doesNotMatch(source, /tile="neutral"/, file);
    }
  });

  test("разделитель — от текста цветной строки", () => {
    assert.equal(SETTINGS_ROW_INSET, 56);
    for (const file of ROOT) {
      for (const m of read(file).matchAll(/<Divider inset=\{([^}]+)\}/g)) {
        assert.ok(m[1] === "SETTINGS_ROW_INSET" || m[1] === "56", `${file}: шов ${m[1]}`);
      }
    }
  });
});
