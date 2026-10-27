import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// «ОТМЕНИТЬ» ПЕРЕВОДА ДОСТУПЕН (аудит 035, F-39). Перевод из листа счёта
// возвращал лист поверх страницы, и его скрим ложился на тост «Переведено ·
// Отменить»: тап закрывал лист, перевод оставался. После записанного перевода
// лист счёта закрывается, если в нём нет несохранённых правок. По исходнику.
const here = dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(resolve(here, file), "utf8");

test("записанный перевод закрывает лист счёта вместо возврата", () => {
  const flow = read("use-close-flow.ts");
  assert.match(flow, /if \(wasSent && \(canFinishAfterTransfer\?\.\(\) \?\? true\)\) onDone\(\);\s*else returnSheet\(\);/);
  const sheet = read("EditAccountSheet.tsx");
  assert.match(sheet, /canFinishAfterTransfer: \(\) => !dirtyRef\.current/);
  assert.match(sheet, /onSent=\{flow\.transfer\.onSent\}/);
  const send = read("../transfer-sheet/use-transfer-send.ts");
  assert.match(send, /s\.onSent\?\.\(\);\s*s\.onClose\(\);/);
});
