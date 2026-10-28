import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { READ_RPCS, WRITE_RPCS } from "@/lib/write-requests";

// ВИД «ТОЛЬКО ДЛЯ ЧТЕНИЯ» ЗОВЁТ ФУНКЦИИ ЧТЕНИЯ (035, П2, ступень 3).
// Сверка записей дельтой спрашивает отпечаток месяцев функцией сервера, а
// календарь читает записи через `readOnlyClient`, у которого был только
// `from().select()`: вызов падал TypeError, и сверка молча шла полным
// чтением. Замер на QA-5 28.10 это и показал.

const SRC = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "queries.ts"), "utf8");
const view = SRC.slice(SRC.indexOf("export function readOnlyClient"), SRC.indexOf("// All tenant appointments (RLS-scoped)"));

describe("readOnlyClient", () => {
  test("rpc есть и пропускает только функции чтения", () => {
    assert.match(view, /rpc: \(name: string, args\?: Record<string, unknown>\) =>\s*READ_RPCS\.has\(name\)/);
    // Вызов — методом базового клиента, а не оторванной функцией.
    assert.match(view, /\.call\(base, name, args\)/);
  });

  test("отпечаток месяцев — функция чтения, а не записи", () => {
    assert.ok(READ_RPCS.has("appointment_month_digest"));
    assert.ok(!WRITE_RPCS.has("appointment_month_digest"));
  });
});
