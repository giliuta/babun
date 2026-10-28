import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// ШАГИ ПЕРЕВОДА — ШТОРКА ВЫБОРА ПО КАНОНУ (AGENTS 5.2): шапка только пропом,
// строк «‹ Назад» в теле нет; свайп и тап мимо возвращают к форме, а не
// закрывают перевод. По исходнику: шаги тянут react-native.
const here = dirname(fileURLToPath(import.meta.url));

for (const file of ["TransferAccountStep.tsx", "TransferDateStep.tsx"]) {
  test(`${file}: закрытие — назад к форме, без «‹ Назад» в теле`, () => {
    const source = readFileSync(resolve(here, file), "utf8");
    assert.match(source, /onClose=\{\(\) => setStep\("form"\)\}/);
    assert.doesNotMatch(source, /StepBack/);
    assert.doesNotMatch(source, /onClose=\{guard\.close\}/);
  });
}
