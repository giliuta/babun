import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// СТРАНИЦА КЛИЕНТОВ — ПРАВИЛА, КОТОРЫЕ ПРОВЕРЯЮТСЯ ПО ИСХОДНИКУ (экраны тянут
// react-native и в тест не импортируются).

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative: string) => readFileSync(resolve(here, relative), "utf8");

describe("команда нового клиента", () => {
  test("без чипа — первая видимая команда ленты, и в черновике, и в импорте", () => {
    assert.match(read("useClientDraft/team.ts"), /teamForNewClient\(liveTeamChoice\(savedTeam, teamIds\), teamIds, isVisible\)/);
    assert.match(read("list/ListSheets.tsx"), /teamForNewClient\(teamChoice, ownTeams\.map\(\(tm\) => tm\.id\), isTeamVisible\)/);
    assert.match(read("use-client-team-choices.ts"), /!isHidden\(team\.tenant_id, team\.id\)/);
  });
  test("черновик показывает «Команда: … ›» и меняет её", () => {
    const page = read("card/ClientCardPage.tsx");
    assert.match(page, /isDraft \? \(\s*<ClientTeamRow teamId=\{c\.team_id \?\? null\} onPick=\{\(teamId\) => update\(\{ team_id: teamId \}\)\} \/>/);
    assert.match(read("ClientTeamRow.tsx"), /`Команда: \$\{name\}`/);
  });
});

describe("«Сменить команду» в «⋯» карточки", () => {
  test("только владелец своей базы, дверью set_client_team", () => {
    const page = read("card/ClientCardPage.tsx");
    assert.match(page, /!isDraft && scope\?\.kind === "own" && teamChoices\.length > 1/);
    assert.match(page, /onChangeTeam=\{onChangeTeam\}/);
    assert.match(read("use-set-client-team.ts"), /rpc\("set_client_team", \{\s*p_client_id: id,\s*p_team_id: teamId,/);
    assert.match(read("client-menu-items.ts"), /label: "Сменить команду"/);
  });
});

describe("фильтры под чипом — выбранное ∩ варианты чипа", () => {
  test("тег, источник и метка другой команды невидимо не фильтруют", () => {
    const src = read("useClientFilters.ts");
    assert.match(src, /return activeTags\.filter\(\(id\) => offered\.has\(id\)\)/);
    assert.match(src, /const sel = liveTags;/);
    assert.match(src, /const sel = \(sources as string\[\]\)\.filter\(\(value\) => offered\.has\(value\)\)/);
    assert.match(src, /\.filter\(\(s\) => offered\.has\(s\)\)/);
  });
});
