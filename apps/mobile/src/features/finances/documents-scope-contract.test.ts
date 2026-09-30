import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// ПЛИТКА И СПИСОК ПОД НЕЙ РЕЖУТ ПО ОДНОМУ ПРАВИЛУ. Арифметика плитки живёт в
// JSX-странице и другим способом не проверяется, а расхождение здесь стоит
// дороже всего: инвойс без команды выпадал из счётчика «Документы», его
// работа уже была вычеркнута из «Долгов» как выставленная, и дебиторка
// исчезала с экрана целиком.
const financesScreen = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../app/(dashboard)/finances/index.tsx",
  ),
  "utf8",
);

const panel = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "DocumentsPanel.tsx"),
  "utf8",
);
const documentsRule = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "documents.ts"),
  "utf8",
);

describe("плитка «Документы» и список под ней — один источник", () => {
  // Аудит 2026-09-29: плитка «Документы 0», а в «Чеках» за тот же месяц 1 чек —
  // плитка считала только инвойсы, ждущие оплату. Теперь число — длина того
  // же списка, что открывается под ней.
  test("плитка печатает длину списка периода, панель берёт тот же список", () => {
    assert.ok(financesScreen.includes("usePeriodDocuments("));
    // Кредит-нота в списке есть, но документом периода не считается (30.09).
    assert.match(
      financesScreen,
      /count:\s*periodDocuments\.documents\.filter\(\(d\) => !d\.creditNote\)\.length/,
    );
    assert.ok(panel.includes("usePeriodDocuments("));
  });

  test("список режет команду общим правилом invoiceInTeamScope", () => {
    assert.ok(documentsRule.includes("invoiceInTeamScope(invoice, sources.teamId)"));
    // Строгое сравнение, прятавшее бумагу без команды, не вернулось.
    assert.doesNotMatch(financesScreen, /invoice\.brigade_id\s*!==\s*scope/);
    assert.doesNotMatch(documentsRule, /invoice\.brigade_id\s*!==\s*sources\.teamId/);
  });
});
