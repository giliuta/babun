import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { readModuleSource } from "@/lib/module-source";
import { financesScreenSource } from "./home/screen-source";

// ПЛИТКА И СПИСОК ПОД НЕЙ РЕЖУТ ПО ОДНОМУ ПРАВИЛУ. Арифметика плитки живёт в
// JSX-странице и другим способом не проверяется, а расхождение здесь стоит
// дороже всего: инвойс без команды выпадал из счётчика «Документы», его
// работа уже была вычеркнута из «Долгов» как выставленная, и дебиторка
// исчезала с экрана целиком.
// The route is layout only; the screen's logic lives in `home/`: read both.
const financesScreen = financesScreenSource();

// The panel is `DocumentsPanel.tsx` plus its `documents-panel/` parts.
const panel = readModuleSource(
  resolve(dirname(fileURLToPath(import.meta.url)), "DocumentsPanel.tsx"),
  resolve(dirname(fileURLToPath(import.meta.url)), "documents-panel"),
);
const documentsRule = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "documents.ts"),
  "utf8",
);

describe("плитка «Документы» и список под ней — один источник", () => {
  // Плитка не должна показывать «Документы 0», когда в «Чеках» за тот же месяц 1
  // чек (раньше она считала только инвойсы, ждущие оплату): число — длина того
  // же списка, что открывается под ней.
  test("плитка печатает длину списка периода, панель берёт тот же список", () => {
    assert.ok(financesScreen.includes("usePeriodDocuments("));
    // Кредит-нота в списке есть, но документом периода не считается.
    assert.match(
      financesScreen,
      /count:\s*periodDocuments\.documents\.filter\(\(d\) => !d\.creditNote\)\.length/,
    );
    assert.ok(panel.includes("usePeriodDocuments("));
    // И вкладки панели считают по тому же правилу: сумма вкладок =
    // плитка.
    assert.ok(panel.includes("d.kind === segment.value && !d.creditNote"));
  });

  test("список режет команду общим правилом invoiceInTeamScope", () => {
    assert.ok(documentsRule.includes("invoiceInTeamScope(invoice, sources.teamId)"));
    // Строгое сравнение, прятавшее бумагу без команды, не вернулось.
    assert.doesNotMatch(financesScreen, /invoice\.brigade_id\s*!==\s*scope/);
    assert.doesNotMatch(documentsRule, /invoice\.brigade_id\s*!==\s*sources\.teamId/);
  });
});
