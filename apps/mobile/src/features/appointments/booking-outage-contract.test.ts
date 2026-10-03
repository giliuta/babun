import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// ФОРМА ЗАПИСИ НА ЛЕЖАЩЕМ СЕРВЕРЕ (03.10 вечер, шлюз отдавал 503/525).
// Три поломки сразу:
//  • упавшее ПЕРЕЧИТЫВАНИЕ команд (данные на руках) меняло заполненную форму
//    на экран ошибки;
//  • под ним вставала сырая HTML-страница Cloudflare «525: SSL handshake
//    failed» и налезала на шапку;
//  • лист услуг без прайса говорил «У команды пока нет услуг» и звал
//    «Добавить услугу» — завести дубль того, что у команды есть.

const MOBILE = path.resolve(__dirname, "../../..");
const book = readFileSync(path.join(MOBILE, "app/book/index.tsx"), "utf8");
const pickers = readFileSync(path.join(MOBILE, "src/features/appointments/BookingPickers.tsx"), "utf8");

describe("booking form while the server is down", () => {
  test("only a failed FIRST load hides the form", () => {
    assert.match(book, /essentialQueries\.find\(\(\{ query \}\) => query\.isLoadingError\)/);
    assert.doesNotMatch(book, /essentialQueries\.find\(\(\{ query \}\) => query\.isError\)/);
  });

  test("the error screen speaks words, not the gateway's HTML", () => {
    const branch = book.slice(book.indexOf("if (failedReference || referencesPending) {"));
    const end = branch.indexOf("\n  return (");
    const body = branch.slice(0, end > 0 ? end : 4000);
    assert.match(body, /loadErrorWords\(failedReference\?\.query\.error/);
    assert.doesNotMatch(body, /\.query\.error\.message/);
  });

  test("a missing price list is not «no services»", () => {
    assert.match(book, /catalog=\{\s*servicesQuery\.isLoadingError\s*\?\s*"failed"/);
    assert.match(pickers, /const catalogMissing = catalogEmpty && catalog !== "ready";/);
    // «Добавить услугу» — только у настоящего пустого прайса.
    const footer = pickers.slice(pickers.indexOf("{catalogMissing ? ("), pickers.indexOf('label="Добавить услугу"'));
    assert.match(footer, /\) : catalogEmpty \? \(/);
  });
});
