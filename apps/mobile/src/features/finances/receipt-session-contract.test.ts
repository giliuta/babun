import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { operationSheetSource } from "./operation-sheet/sheet-source";

// СТОРОЖ: файл чека чистит ФОРМА, когда закрыта насовсем, а не строка на
// своём размонтировании (аудит 2026-09-24). Лист снимает строку при каждом
// отъезде — вопрос «Закрыть без сохранения?», поход за клиентом, — и чистка
// строки стирала файл, который форма ещё держала.
const here = dirname(fileURLToPath(import.meta.url));
const read = (f: string) => readFileSync(join(here, f), "utf8");

describe("чистка файла чека — у формы", () => {
  test("строка файла не чистит на размонтировании и берёт сессию формы", () => {
    const row = read("OperationReceiptRow.tsx");
    assert.ok(!row.includes("discardOperationReceiptIfOrphan"), "строка снова чистит сама");
    assert.ok(row.includes("session.uploads"), "строка не пишет в сессию формы");
  });
  test("обе формы держат сессию и чистят при закрытии", () => {
    // The operation form is `OperationSheet.tsx` plus `operation-sheet/`.
    const sources = { "OperationSheet.tsx": operationSheetSource(), "use-debt-draft.ts": read("use-debt-draft.ts") };
    for (const [f, src] of Object.entries(sources)) {
      assert.ok(src.includes("useReceiptSession()"), `${f}: нет сессии файлов`);
      assert.ok(src.includes("receiptSession.flush()"), `${f}: не чистит при закрытии`);
    }
    // Долг, уехавший за клиентом, файл не теряет.
    assert.match(read("use-debt-draft.ts"), /!visible && !wentForClient\.current\) receiptSession\.flush\(\)/);
  });
});
