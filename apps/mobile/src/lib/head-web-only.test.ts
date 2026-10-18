import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// `Head` из expo-router — только сайту. На iOS он регистрирует Handoff и
// требует origin в конфиге сборки; без него в отладке экран падает в общий
// «Экран не открылся», а в сборке из магазина человек видит системный алерт
// с технической фразой — например, открыв «Политику конфиденциальности».
// Заголовки вкладки и meta-теги нужны только вебу, поэтому каждый `<Head>`
// стоит под `Platform.OS === "web"`.

const MOBILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) yield* sources(full);
    else if (/\.tsx$/.test(name) && !/\.web\.tsx$/.test(name)) yield full;
  }
}

test("каждый <Head> из expo-router стоит под Platform.OS === \"web\"", () => {
  const bad: string[] = [];
  let seen = 0;
  for (const dir of ["app", "src"]) {
    for (const file of sources(path.join(MOBILE, dir))) {
      const src = readFileSync(file, "utf8");
      if (!src.includes('from "expo-router/head"')) continue;
      const lines = src.split("\n");
      lines.forEach((line, i) => {
        if (!/<Head>/.test(line)) return;
        seen += 1;
        const before = lines.slice(Math.max(0, i - 3), i).join("\n");
        if (!/Platform\.OS === "web"/.test(before)) bad.push(`${path.relative(MOBILE, file)}:${i + 1}`);
      });
    }
  }
  assert.ok(seen >= 4, "сторож не нашёл ни одного <Head> — путь сканирования сломан");
  assert.deepEqual(bad, []);
});
