import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// КНОПКА ЛИСТА НЕ УХОДИТ ЗА КРАЙ. Тело без прокрутки лежало в обёртке, которая
// не умела сжиматься: содержимое выше потолка листа выталкивало подвал, и
// панель с `overflow: hidden` срезала «Применить» (валюта, часовой пояс).

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative: string) => readFileSync(resolve(here, relative), "utf8");

test("тело листа без прокрутки сжимается, подвал остаётся на месте", () => {
  const sheet = read("BottomSheet.tsx");
  assert.match(
    sheet,
    /\) : padded \? \([\s\S]{0,400}?<View style=\{\{ paddingHorizontal: GUTTER, flexShrink: 1, minHeight: 0 \}\}>\{shown\.children\}<\/View>/,
  );
});

test("валюта и часовой пояс: барабан не сжать — тело листается, поиск над клавиатурой", () => {
  for (const path of [
    "../../features/settings/CurrencySheet.tsx",
    "../../features/calendar/TimezoneSheet.tsx",
  ]) {
    const source = read(path);
    const open = source.slice(source.indexOf("<BottomSheet"), source.indexOf("footer={", source.indexOf("<BottomSheet")));
    assert.match(open, /\n\s+scroll\n/, `${path}: тело без прокрутки — «Применить» уходит за край`);
    assert.match(open, /\n\s+avoidKeyboard\n/, `${path}: результаты поиска под клавиатурой`);
  }
});
