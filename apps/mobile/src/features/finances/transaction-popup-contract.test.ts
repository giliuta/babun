import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { readModuleSource } from "@/lib/module-source";

// ЛИСТ ОПЕРАЦИИ ДОЖИВАЕТ ДО КОНЦА УХОДА. Лента открывает его самим
// значением (`visible={!!popupTx}`, `transaction={popupTx}`) и на закрытии
// обнуляет оба в одном кадре. Вопрос «Удалить перевод?» / «Удалить операцию?»
// лист задаёт по `onExited` — а ранний `if (!transaction) return null` снимал
// лист целиком, `onExited` не приходил, и «Отменить перевод» закрывал лист
// молча: перевод оставался в ленте.
// The sheet is `TransactionPopup.tsx` plus its `transaction-popup/` parts.
const here = dirname(fileURLToPath(import.meta.url));
const popup = readModuleSource(
  resolve(here, "TransactionPopup.tsx"),
  resolve(here, "transaction-popup"),
);

test("лист операции держит последнюю операцию, пока уезжает", () => {
  assert.match(popup, /useLastNonNull\(transaction\)/);
  assert.doesNotMatch(popup, /if \(!transaction\) return null/);
});

test("вопрос об удалении ждёт ухода листа, а не таймера", () => {
  assert.match(popup, /afterExit\.current = \(\) => \{\s*confirmThen\(/);
  assert.match(popup, /onExited=\{\(\) => \{\s*const run = afterExit\.current;/);
});
