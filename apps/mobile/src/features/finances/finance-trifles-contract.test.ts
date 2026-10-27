import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// МЕЛОЧИ «ФИНАНСОВ». По исходнику: экраны тянут react-native.
const here = dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(resolve(here, file), "utf8");

test("правка операции без правок — «Сохранить» серая", () => {
  const sheet = read("OperationSheet.tsx");
  assert.match(sheet, /const unchangedEdit = isEdit && !dirty && teamId === \(transaction\?\.team_id \?\? null\);/);
  assert.match(sheet, /canSave=\{canSave && !unchangedEdit\}/);
  assert.match(read("operation-sheet/use-operation-close.ts"), /return \{ askingClose, guardedClose, runAfterExit, dirty \};/);
});

test("пустые ящики — заголовок и пояснение, а не «Пусто»", () => {
  const operations = read("DeletedOperationsScreen.tsx");
  const accounts = read("../../../app/accounts/trash.tsx");
  for (const screen of [operations, accounts]) assert.doesNotMatch(screen, /title="Пусто"/);
  assert.match(operations, /title="Удалённых операций нет"/);
  assert.match(accounts, /title="Удалённых счетов нет"/);
});
