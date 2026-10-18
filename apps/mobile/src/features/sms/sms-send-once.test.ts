import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// ОДИН ТАП — ОДНА ПЛАТНАЯ SMS. Шторка уезжает ~260 мс, и всё это время её
// футер нажимается: второй тап по «Отправить от …» звал `sms_send_manual`
// второй раз и списывал с баланса две SMS. Шторку не поднять без
// react-native, поэтому сторож читает исходник.

const here = dirname(fileURLToPath(import.meta.url));
const source = () => readFileSync(resolve(here, "SmsSendSheet.tsx"), "utf8");

function bodyOf(src: string, name: string): string {
  const start = src.indexOf(`const ${name} = () => {`);
  assert.ok(start >= 0, `${name} не найден`);
  const end = src.indexOf("\n  };\n", start);
  return src.slice(start, end);
}

describe("SmsSendSheet: отправка через сервис", () => {
  test("второй тап, пока отправка в пути, не зовёт сервис", () => {
    const fn = bodyOf(source(), "sendFromCompany");
    const guard = fn.search(/if \(sendingRef\.current\) return;/);
    const take = fn.search(/sendingRef\.current = true;/);
    const mutate = fn.indexOf("send.mutate(");
    assert.ok(guard >= 0, "нет проверки «отправка уже в пути»");
    assert.ok(take > guard && take < mutate, "флаг ставится до вызова сервиса");
    assert.match(fn, /onSettled: \(\) => \{\s*sendingRef\.current = false;/);
  });

  test("кнопка «Отправить от …» погашена, пока отправка в пути", () => {
    const src = source();
    const button = src.slice(src.indexOf("onPress={sendFromCompany}"));
    assert.match(button.slice(0, 120), /disabled=\{!body \|\| send\.isPending\}/);
  });
});
