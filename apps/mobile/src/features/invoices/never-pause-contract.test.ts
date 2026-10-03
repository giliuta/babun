import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative: string) => readFileSync(resolve(here, relative), "utf8");

// ДОКУМЕНТЫ БЕЗ СВЯЗИ ПАДАЮТ ЧЕСТНО (проверка системы 03.10).
//
// По умолчанию react-query паркует запись без сети в «паузу» — без ошибки и
// без конца: «Выставить», «Отменить», «Оплата по инвойсу» и «Выписать чек»
// просто ничего не делали, а свёрнутое приложение уносило намерение молча.
// Деньги и документы онлайн-only на запись: каждая их мутация обязана нести
// `NEVER_PAUSE`, как операции и счета (`finances/accounts.ts`).

const FILES = ["./queries.ts", "../documents/receipts-queries.ts"];

describe("инвойсы и чеки — запись без сети не встаёт на паузу", () => {
  for (const file of FILES) {
    test(file, () => {
      const source = read(file);
      const mutations = source.split("useMutation({").slice(1);
      assert.ok(mutations.length > 0, `${file}: мутаций не найдено`);
      for (const body of mutations) {
        assert.match(body.slice(0, 40), /^\s*\.\.\.NEVER_PAUSE,/, `${file}: мутация без NEVER_PAUSE`);
      }
    });
  }
});
