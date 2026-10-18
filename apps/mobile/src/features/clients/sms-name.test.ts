import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { addressedAs, firstName } from "@/lib/sms-name";

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

// Эмодзи клиенту не уходят — их режет и сервер отправки, — поэтому имя из
// одних эмодзи должно стать пустым ДО подстановки: иначе шаблон
// «Здравствуйте, [Имя]!» уходит как «Здравствуйте, !».
describe("[Имя] без эмодзи", () => {
  test("первое слово имени — без эмодзи", () => {
    assert.equal(firstName({ full_name: "🌸 Анна" }), "Анна");
    assert.equal(firstName({ full_name: "Анна🌸 Петрова" }), "Анна");
    assert.equal(firstName({ full_name: "😀😀" }), "");
  });

  test("«Обращение» без эмодзи; из одних эмодзи — запасное имя", () => {
    assert.equal(addressedAs({ sms_name: "Мария ❤️" }, "Мария"), "Мария");
    assert.equal(addressedAs({ sms_name: "👍" }, "Анна"), "Анна");
    assert.equal(addressedAs({ sms_name: "" }, "👍"), "");
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
