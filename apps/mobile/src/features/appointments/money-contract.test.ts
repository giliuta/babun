import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// ДВА СТОРОЖА НАД ДЕНЕЖНЫМ ЛИСТОМ. Оба поставлены по следам аудита
// 2026-09-20, и каждый охраняет дефект, который в тот день РЕАЛЬНО ЖИЛ в
// дереве полдня и не уронил ни одной пробы.
//
// Проверка по ИСХОДНОМУ ТЕКСТУ — тем же приёмом, что `blocks-catalog.test.ts`
// и `receipt-paper-contract.test.ts`: RN-компоненты в этом дереве не
// рендерятся (тесты гоняет `node:test`, снапшотов компонентов нет), а оба
// дефекта видны именно в коде.

const here = dirname(fileURLToPath(import.meta.url));
const APP_SRC = resolve(here, "..", "..");

function sourcesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourcesUnder(full));
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Код без комментариев: прозаическое упоминание формулы рядом с шапкой
 *  файла не имеет права ни подтвердить проверку, ни сломать её. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("деньги считает один канон", () => {
  // НАЛОГ СЧИТАЕТСЯ В ОДНОМ МЕСТЕ НА ПРОДУКТ — `applyTxVat`
  // (`shared/local/finance/vat.ts`), и серверная `fill_transaction_vat`
  // вторит ей же.
  //
  // ЧТО БЫЛО. В `VatLooks.tsx` жила своя копия формулы в double:
  // `round2(net * rate / 100)` для «сверху» и `round2(net * rate / (100 +
  // rate))` для «в цене». На реальных деньгах она расходилась с каноном:
  // нетто €42,50 при 19 % давало €50,57 вместо €50,58 — то есть шторка
  // «Итого», чек и журнал по одной работе называли РАЗНЫЕ суммы. Копия
  // прожила полдня: ни одна проба её не сторожила, потому что сама по себе
  // она считала «правдоподобно».
  test("второй формулы НДС в приложении нет", () => {
    const guilty: string[] = [];
    for (const file of sourcesUnder(APP_SRC)) {
      const code = stripComments(readFileSync(file, "utf8"));
      // Обе формы деления на ставку: `* rate) / 100` и `/ (100 + rate)`.
      if (/\/\s*100\b/.test(code) && /\brate\b/.test(code)) {
        if (/\*\s*\w*[Rr]ate\w*\s*\)?\s*\/\s*\(?\s*100/.test(code)) {
          guilty.push(file.slice(APP_SRC.length + 1));
        }
      }
    }
    assert.deepEqual(
      guilty,
      [],
      `НДС считается мимо канона \`applyTxVat\` в: ${guilty.join(", ")}`,
    );
  });
});

describe("живой орган не прячут стилем", () => {
  // ЧТО БЫЛО. Новый вид шторки «Итого» поставили рядом со старым, а старый
  // на время примерки спрятали `display: "none"` — 95 строк разметки, и
  // ВМЕСТЕ С НИМИ клавиша «По услугам»: единственный способ вернуть записи
  // со старой ручной суммой счёт по строкам. Экран выглядел рабочим, типы
  // сходились, тесты были зелёные — а выхода из ручной суммы у человека не
  // стало. Спрятанная разметка — это мёртвый код, который выглядит живым;
  // канон сносит мёртвое в том же заходе.
  const MONEY_FILES = [
    "features/appointments/TotalSheet.tsx",
    "features/appointments/VatLooks.tsx",
    "features/documents/ReceiptComposer.tsx",
  ];

  for (const relative of MONEY_FILES) {
    test(`${relative} — без display: "none"`, () => {
      const code = stripComments(readFileSync(resolve(APP_SRC, relative), "utf8"));
      assert.ok(
        !/display:\s*["']none["']/.test(code),
        `${relative} прячет разметку стилем — спрятанное либо живёт, либо сносится`,
      );
    });
  }

  // «По услугам» — не украшение: без неё запись с ручной суммой навсегда
  // осталась бы со своим числом, не сходящимся со строками.
  test("«По услугам» осталась на экране", () => {
    const code = stripComments(
      readFileSync(resolve(APP_SRC, "features/appointments/TotalSheet.tsx"), "utf8"),
    );
    assert.match(code, /По услугам/);
    assert.match(code, /customTotal\s*\?/);
  });
});
