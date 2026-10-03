import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// НОВЫЙ КЛИЕНТ — ОТ ТОЙ КОМАНДЫ, КУДА ОН УЙДЁТ (аудит 03.10).
// (а) Клиент, заведённый из записи, уходил в команду последнего чипа вкладки
//     «Клиенты», а не в команду записи.
// (б) Подпись страны над номером черновика бралась от пояса компании: у
//     черновика нет `team_id` до сохранения, а подпись бралась один раз.

const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string) => readFileSync(resolve(here, path), "utf8");

describe("команда и страна нового клиента", () => {
  test("запись отдаёт карточке свою команду, карточка — черновику", () => {
    assert.match(read("../../../app/book/index.tsx"), /params: \{ id: "new", \.\.\.prefill, \.\.\.\(teamId \? \{ team: teamId \} : \{\}\) \}/);
    assert.match(read("../../../app/(dashboard)/clients/[id].tsx"), /team: isDraft \? \(teamParam \?\? null\) : null,/);
  });

  test("команда записи сильнее чипа вкладки", () => {
    const draft = read("useClientDraft.ts");
    assert.match(draft, /const newClientTeam =\s*bookingTeam \?\? teamForNewClient\(/);
  });

  test("команда черновика ставится сразу, выбранную руками не трогает", () => {
    const draft = read("useClientDraft.ts");
    assert.match(draft, /\(!current\.team_id \|\| current\.team_id === previous\) &&\s*current\.team_id !== newClientTeam/);
  });

  test("пустое поле номера идёт за страной команды, выбранная руками — нет", () => {
    const hook = read("use-phone-country.tsx");
    assert.match(hook, /if \(picked\.current \|\| phone\.trim\(\)\) return;\s*setCountry\(\(cur\) => \(cur === home \? cur : home\)\);/);
    assert.match(hook, /const pick = \(next: CountryCode\) => \{\s*picked\.current = true;/);
  });
});
