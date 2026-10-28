import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// ПРОШЕДШИЙ НЕОПЛАЧЕННЫЙ ВИЗИТ — «ДОЛГ», КАК В КАЛЕНДАРЕ. Хук блока тянет
// react-native и под раннером не поднимается — проверка идёт по исходнику.

const here = dirname(fileURLToPath(import.meta.url));
const hook = readFileSync(resolve(here, "use-payment-block.ts"), "utf8");

test("подпись блока считает визит состоявшимся по часам, а не по статусу", () => {
  assert.match(
    hook,
    /visitCompleted: appointment !== null && isPastRecord\(appointment, now\.ymd, now\.hm\)/,
  );
  assert.doesNotMatch(hook, /visitCompleted: appointment\?\.status === "completed"/);
});
