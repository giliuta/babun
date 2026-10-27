import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { bookFormSource } from "./book-form/source-for-tests";

// ФОРМА ЗАПИСИ ДЕРЖИТ СВОЮ ЗАПИСЬ.
//
// 1. Ссылка на другую запись при открытой форме меняла параметры того же
//    экрана: дата и время оставались от прежней записи, оплата приходила от
//    новой, и «Сохранить» перенёс бы запись на чужой день.
// 2. Шторка «Услуги» считала подвал по сегодняшнему прайсу: запись держит
//    чистку по €30, прайс поднят до €50 — лист обещал «Применить · 1 · €50»,
//    а форма честно оставляла €30.

// The booking form is the route plus `book-form/` (route first).
const book = bookFormSource();
const picker = readFileSync(path.join(__dirname, "BookingPickers.tsx"), "utf8");

describe("форма записи и её запись", () => {
  test("другая запись в адресе собирает форму заново", () => {
    // Ключ формы начинается с записи; метка `fresh` («Удалить черновик»)
    // идёт следом и собирает новую запись с чистого листа.
    assert.match(book, /export default function BookScreen\(\) \{\n  const params = useLocalSearchParams<\{ appointmentId\?: string; fresh\?: string \}>\(\);\n  return <BookForm key=\{`\$\{first\(params\.appointmentId\) \?\? "new"\}:\$\{first\(params\.fresh\) \?\? ""\}`\} \/>;\n\}/);
    assert.equal(book.match(/export default function/g)?.length, 1);
  });

  test("шторка услуг берёт цену, которую держит запись", () => {
    assert.match(book, /recordLines=\{Object\.fromEntries\(\n\s+selectedServices/);
    assert.match(book, /overrides\[line\.serviceId\]\?\.locked != null \|\|\n\s+overrides\[line\.serviceId\]\?\.price != null/);
    assert.match(picker, /const held = recordLines\?\.\[id\];\n\s+if \(held\) return sum \+ held\.total;/);
    assert.match(picker, /formatEURExact\(recordLines\?\.\[s\.id\]\?\.unitPrice \?\? s\.price\)\} · \$\{durationLabel/);
  });
});
