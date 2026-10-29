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

describe("визит — одно правило для списка и «Истории»", () => {
  test("итог истории считает визиты `isVisit`, незакрытая — с пометкой", () => {
    assert.match(read("../../../app/(dashboard)/clients/visits.tsx"), /const done = appointments\.filter\(\(a\) => isVisit\(a\) && \(a\.kind \?\? "work"\) === "work"\);/);
    const row = read("VisitRow.tsx");
    assert.match(row, /a\.status !== "cancelled" && a\.status !== "completed" && !!a\.date && a\.date < today/);
    assert.match(row, /unclosed \? "не закрыта" : ""/);
  });
});

describe("улика под именем в списке", () => {
  test("поиск — поле совпадения, статус — его улика", () => {
    const body = read("list/ListBody.tsx");
    assert.match(body, /query\.trim\(\)\s*\?\s*clientMatchEvidence\(c, query\)\s*:\s*segmentEvidence\(c, filter\.segments, statsMap\.get\(c\.id\), today\)/);
    assert.match(body, /evidence=\{evidenceOf\(item\)\}/);
  });
});

describe("«Блоки клиентов»", () => {
  const page = () => read("../../../app/(dashboard)/clients/card-fields.tsx");
  test("без пояснений под карточками, блок SMS выключается", () => {
    assert.doesNotMatch(page(), /<RowCaption/);
    assert.match(page(), /\{ label: "SMS", key: "client_sms", icon: MessageSquare \}/);
    assert.match(read("card-access.ts"), /sms: block\(teamOn\.sms, "clients\.sms"\)/);
  });
});

describe("пустой каталог тегов", () => {
  test("«Создать тег» — футером шторки, а не кнопкой внутри", () => {
    const sheet = read("TagPickerSheet.tsx");
    assert.match(sheet, /\) : onCreateTag \? \(\s*<View style=\{\{ paddingHorizontal: FOOTER_SIDE \}\}>\s*<Button label="Создать тег" onPress=\{onCreateTag\} \/>/);
    assert.match(read("ClientLabelTags.tsx"), /onCreateTag=\{tagsDoor \?/);
  });
});

describe("имя клиента в шапке при прокрутке", () => {
  test("карточка уехала — шапка называет клиента", () => {
    const page = read("card/ClientCardPage.tsx");
    assert.match(page, /scrolledTitle=\{nameScrolled \? c\.full_name \|\| c\.phone \|\| null : null\}/);
    assert.match(read("ClientDetailChrome.tsx"), /title=\{draft \? "Новый клиент" : scrolledTitle \|\| "Клиент"\}/);
  });
});

describe("тип объекта в фильтре — один «Дом»", () => {
  test("старое `house` и живое «Дом» — один вариант", async () => {
    const { propertyFacetOptions } = await import("./useClientFilters/options");
    const { createBlankClient } = await import("@babun/shared/local/clients");
    const withType = (id: string, label: string) =>
      createBlankClient({
        id,
        full_name: id,
        locations: [{ id: `${id}-l`, label, address: "", isPrimary: true }] as never,
      });
    const options = propertyFacetOptions([withType("a", "house"), withType("b", "Дом")]);
    assert.equal(options.filter((o) => o.label === "Дом").length, 1);
  });
});

describe("массовая правка больше 500 — порциями", () => {
  test("пачка режется по 500, итог складывается", () => {
    const src = read("bulk-edit-rpc.ts");
    assert.match(src, /for \(let from = 0; from < edits\.length; from \+= BATCH_LIMIT\)/);
    assert.doesNotMatch(src, /За раз — не больше/);
  });
  test("«вернуть 1 клиента — они» больше не пишется", () => {
    const src = read("delete-undo.ts");
    assert.match(src, /lost === 1\s*\?\s*"Не удалось вернуть клиента — он в удалённых, верните вручную"/);
  });
});
