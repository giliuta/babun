import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// ЦИФРА В КАБИНЕТЕ = СПИСОК НА ЭКРАНЕ «СИНХРОНИЗАЦИЯ». Очередь одна на
// телефон, а экран показывает только операции открытой компании. Бейдж
// считал всю очередь: «3 ждут отправки», а за тапом — пустой список. Счёт с
// фильтром проверяет `packages/shared/src/sync/queue-depth.test.ts`; здесь —
// что кабинет отдаёт ему тот же фильтр, что экран.

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative: string) => readFileSync(resolve(here, relative), "utf8");

test("кабинет считает бейдж фильтром экрана «Синхронизация»", () => {
  const cabinet = read("../../app/(dashboard)/cabinet/index.tsx");
  assert.match(cabinet, /isQueuedOpVisibleForTenant\(op, tenantId\)/);
  assert.match(cabinet, /useQueueDepth\(visibleOp\)/);
  const screen = read("../../app/(dashboard)/cabinet/sync.tsx");
  assert.match(screen, /isQueuedOpVisibleForTenant\(op, tenantId\)/);
});
