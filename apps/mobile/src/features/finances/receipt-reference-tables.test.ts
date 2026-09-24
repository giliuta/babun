import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import { RECEIPT_REFERENCE_TABLES } from "./receipt-reference-tables";

// ЧИСТКА ФАЙЛА К ДЕНЬГАМ ОБЯЗАНА ЗНАТЬ КАЖДОЕ МЕСТО, ГДЕ НА НЕГО ССЫЛАЮТСЯ.
// 24.09 чистка спрашивала одни операции, и сохранённый файл долга (он живёт
// в `debts.receipt_url`) стирался при закрытии листа. Сторож читает миграции:
// любая таблица схемы `public`, которой добавили `receipt_url`, должна стоять
// в `RECEIPT_REFERENCE_TABLES`.

const MIGRATIONS = join(__dirname, "../../../../../supabase/migrations");

function tablesWithReceiptUrl(): Set<string> {
  const out = new Set<string>();
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"))) {
    const sql = readFileSync(join(MIGRATIONS, file), "utf8").replace(/--[^\n]*/g, "");
    for (const statement of sql.split(";")) {
      if (!/\breceipt_url\b/.test(statement)) continue;
      const table =
        /alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(public\.)?(\w+)\s+add\s+column[\s\S]*\breceipt_url\b/i.exec(statement) ??
        /create\s+table\s+(?:if\s+not\s+exists\s+)?(public\.)?(\w+)\s*\([\s\S]*\breceipt_url\b/i.exec(statement);
      if (table) out.add(table[2]);
    }
  }
  return out;
}

describe("файл к деньгам — чистка знает все ссылки", () => {
  test("каждая таблица с receipt_url стоит в списке чистки", () => {
    const found = tablesWithReceiptUrl();
    assert.ok(found.size >= 3, `миграции прочитаны: ${[...found].join(", ")}`);
    for (const table of found) {
      assert.ok(
        (RECEIPT_REFERENCE_TABLES as readonly string[]).includes(table),
        `таблица ${table} хранит receipt_url, но чистка её не спрашивает`,
      );
    }
  });
});
