import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { readModuleSource } from "@/lib/module-source";
import { bookFormSource } from "../appointments/book-form/source-for-tests";
import { clientCardSource } from "./card/source-for-tests";

// НОВЫЙ КЛИЕНТ — ОТ ТОЙ КОМАНДЫ, КУДА ОН УЙДЁТ (аудит 03.10).
// (а) Клиент, заведённый из записи, уходил в команду последнего чипа вкладки
//     «Клиенты», а не в команду записи.
// (б) Подпись страны над номером черновика бралась от пояса компании: у
//     черновика нет `team_id` до сохранения, а подпись бралась один раз.

const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string) => readFileSync(resolve(here, path), "utf8");

describe("команда и страна нового клиента", () => {
  test("запись отдаёт карточке свою команду, карточка — черновику", () => {
    assert.match(bookFormSource(), /params: \{ id: "new", \.\.\.prefill, \.\.\.\(teamId \? \{ team: teamId \} : \{\}\) \}/);
    assert.match(clientCardSource(), /team: isDraft \? \(teamParam \?\? null\) : null,/);
  });

  test("команда записи сильнее чипа вкладки", () => {
    const draft = readModuleSource(resolve(here, "useClientDraft.ts"));
    assert.match(draft, /const newClientTeam =\s*bookingTeam \?\? teamForNewClient\(/);
  });

  test("команда черновика ставится сразу, выбранную руками не трогает", () => {
    const draft = readModuleSource(resolve(here, "useClientDraft.ts"));
    assert.match(draft, /\(!current\.team_id \|\| current\.team_id === previous\) &&\s*current\.team_id !== newClientTeam/);
  });

  test("код в ненабранном поле номера идёт за страной команды, стёртый руками — нет", () => {
    const hook = read("use-phone-country.tsx");
    assert.match(hook, /const untouched = seeded\.current === null \? typed === "" : typed === seeded\.current;/);
    assert.match(hook, /onChange\(dialPrefix\(home\)\);/);
  });
});
