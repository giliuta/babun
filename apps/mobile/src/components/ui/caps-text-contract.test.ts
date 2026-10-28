import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { capsText } from "./caps-text";

// КАПС В ПРИМИТИВАХ — СТРОКОЙ. `textTransform: "uppercase"` на Android
// срезал последнюю букву подписи: «CLIEN», «FILE» (эмулятор, 28.10).

const here = dirname(fileURLToPath(import.meta.url));

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(name)) out.push(p);
  }
  return out;
}

test("примитивы не просят заглавные у движка текста", () => {
  const offenders = walk(here)
    .filter((f) => /textTransform:\s*"uppercase"/.test(readFileSync(f, "utf8")))
    .map((f) => relative(here, f));
  assert.deepEqual(offenders, []);
});

test("заглавные — из уже переведённой строки", () => {
  assert.equal(capsText("Files"), "FILES");
  assert.equal(capsText("Клиент"), "КЛИЕНТ");
});
