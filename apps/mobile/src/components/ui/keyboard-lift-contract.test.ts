import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// ПОДЪЁМ НАД КЛАВИАТУРОЙ МЕРИТ РАМКУ В КООРДИНАТАХ ЭКРАНА. Штатный
// KeyboardAvoidingView сравнивал низ рамки в координатах родителя с верхом
// клавиатуры в координатах экрана, и на страницах под вырезом кнопки футера
// («Пригласить», «Выставить инвойс», «Сменить пароль») уходили под клавиатуру
// на высоту выреза. Вручную переданный сдвиг был лишь в двух местах из десяти.

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, "../../..");
const read = (f: string) => readFileSync(f, "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

test("подъём меряет рамку от корня экрана в момент события клавиатуры", () => {
  const lift = read(resolve(here, "KeyboardLift.tsx"));
  assert.match(lift, /ref\.current\?\.measure\(\(_x, _y, _w, h, _pageX, pageY\) =>/);
  assert.match(lift, /pageY \+ h - kb\.screenY/);
  // iOS — в такт анимации клавиатуры и при смене её высоты.
  assert.match(lift, /IOS \? "keyboardWillShow" : "keyboardDidShow"/);
  assert.match(lift, /IOS \? "keyboardWillHide" : "keyboardDidHide"/);
  // Ручной сдвиг больше не участвует в расчёте.
  assert.doesNotMatch(lift, /keyboardVerticalOffset=\{/);
});

test("штатный KeyboardAvoidingView нигде не используется мимо KeyboardLift", () => {
  const offenders = [...walk(resolve(app, "src")), ...walk(resolve(app, "app"))]
    .filter((f) => /<KeyboardAvoidingView\b/.test(read(f)))
    .map((f) => relative(app, f));
  assert.deepEqual(offenders, []);
});
