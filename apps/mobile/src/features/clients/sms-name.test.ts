import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { addressedAs, firstName } from "./sms-name";

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative: string) => readFileSync(resolve(here, relative), "utf8");

describe("[Имя] в SMS — «Обращение» клиента", () => {
  test("заполненное «Обращение» побеждает имя карточки", () => {
    const c = { full_name: "Иванов Пётр (вилла)", sms_name: " Пётр Иванович " };
    assert.equal(addressedAs(c, firstName(c)), "Пётр Иванович");
  });

  test("пустое — прежнее значение места", () => {
    const c = { full_name: "Мария Спиру", sms_name: "  " };
    assert.equal(addressedAs(c, firstName(c)), "Мария");
    assert.equal(addressedAs(null, "Контакт чата"), "Контакт чата");
  });
});

// Проводка: оба места, где шаблон получает [Имя], обязаны спрашивать
// «Обращение». Экраны импортировать нельзя — за ними тянется react-native,
// которого в node:test нет, поэтому сторож смотрит в исходники.
describe("шаблоны подставляют «Обращение»", () => {
  test("массовая рассылка", () => {
    assert.match(read("bulk-sms.ts"), /addressedAs\(client, firstName\(client\)\)/);
  });

  test("вставка шаблона в чат", () => {
    assert.match(read("../../../app/(dashboard)/chats/[id].tsx"), /addressedAs\(\s*linkedClient,/);
  });
});
