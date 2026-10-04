import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// ЛИСТ ОПЕРАЦИИ ДОЖИВАЕТ ДО КОНЦА УХОДА (04.10). Лента открывает его самим
// значением (`visible={!!popupTx}`, `transaction={popupTx}`) и на закрытии
// обнуляет оба в одном кадре. Вопрос «Удалить перевод?» / «Удалить операцию?»
// лист задаёт по `onExited` — а ранний `if (!transaction) return null` снимал
// лист целиком, `onExited` не приходил, и «Отменить перевод» закрывал лист
// молча: перевод оставался в ленте.
const popup = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "TransactionPopup.tsx"),
  "utf8",
);

test("лист операции держит последнюю операцию, пока уезжает", () => {
  assert.match(popup, /useLastNonNull\(transaction\)/);
  assert.doesNotMatch(popup, /if \(!transaction\) return null/);
});

test("вопрос об удалении ждёт ухода листа, а не таймера", () => {
  assert.match(popup, /afterExit\.current = \(\) => \{\s*confirmThen\(/);
  assert.match(popup, /onExited=\{\(\) => \{\s*const run = afterExit\.current;/);
});
