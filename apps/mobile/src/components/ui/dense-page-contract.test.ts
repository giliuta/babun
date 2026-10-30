import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// ПЛОТНАЯ СТРАНИЦА — ЗАПИСЬ И СОБЫТИЕ, И ТОЛЬКО ОНИ. Блоки записи (клиент,
// услуги) стоят и в чеке с инвойсом — там воздух прежний; лист, открытый со
// страницы записи, — своя страница. Компоненты тянут react-native — проверка
// по исходнику.

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(here, rel), "utf8");

test("запись и событие стоят на плотной странице", () => {
  const book = read("../../../app/book/index.tsx");
  assert.match(
    book,
    /<DensePage value>\s*\{kind === "work" \? <WorkBody form=\{form\} \/> : <EventBody form=\{form\} \/>\}\s*<\/DensePage>/,
  );
});

test("лист сбрасывает плотность страницы под собой", () => {
  const sheet = read("BottomSheet.tsx");
  assert.match(sheet, /const layers = \([\s\S]{0,120}?<DensePage value=\{false\}>/);
});

test("оплата на плотной странице ниже", () => {
  const pay = read("../../features/appointments/PaymentBlock.tsx");
  assert.match(pay, /minHeight=\{densePage \? 32 : 40\}/);
  assert.match(pay, /height=\{densePage \? 36 : undefined\}/);
});
