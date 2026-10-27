import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// «ИТОГО» ИНВОЙСА — ЧЕРНОВИКОМ ДО «ПРИМЕНИТЬ», как лист счёта: свайп и
// затемнение с правками спрашивают и откатывают, без правок — закрывают.
// У записи закрытие по-прежнему применяет. По исходнику: тянет react-native.
const here = dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(resolve(here, file), "utf8");
const invoice = read("InvoiceTotalSheet.tsx");
const shared = read("../../appointments/TotalSheet.tsx");

test("инвойс: закрытие мимо кнопки — через сторожа с вопросом о применении", () => {
  assert.match(invoice, /onDismiss=\{guard\.close\}/);
  assert.match(invoice, /title: "Закрыть без применения\?"/);
  assert.match(invoice, /onLinesRestore\(was\.lines\)/);
  assert.match(invoice, /visible=\{visible && !guard\.hidden\}/);
});

test("общий лист: без onDismiss закрытие применяет, как у записи", () => {
  assert.match(shared, /onClose=\{onDismiss \?\? apply\}/);
});
