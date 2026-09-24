import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// ПРОВОДКА ТРЁХ ДОБАВОК КАРТОЧКИ КЛИЕНТА (22.09): «был 12 авг» у объекта,
// «Обращение» в «Личном», тап по долгу → «Неоплаченные». Правила — чистые
// функции со своими тестами; здесь сторожится то, что ломается молча: что
// экраны этими функциями пользуются. Экраны импортировать нельзя — за ними
// тянется react-native, которого в node:test нет.

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative: string) => readFileSync(resolve(here, relative), "utf8");

describe("«был …» у объекта", () => {
  test("карточка клиента считает дату по записям и отдаёт блоку", () => {
    // Объекты живут своим куском — он же стоит и на странице всех объектов.
    const blocks = read("ClientObjectsSection.tsx");
    assert.match(blocks, /lastVisitByObject\(appointments\)/);
    assert.match(blocks, /lastVisitFor=\{/);
  });

  test("дата стоит в третьей строке рядом с заметкой, а не этажом ниже", () => {
    const row = read("blocks/ObjectsBlock.tsx");
    assert.match(row, /\[visited, note\]\.filter\(Boolean\)\.join\(" · "\)/);
    assert.match(row, /lastVisit=\{lastVisitFor\?\.\(loc\)\}/);
  });
});

describe("«Обращение» со страницы убрано", () => {
  // Владелец 22.09: «блок обращения давай уберём». Поле остаётся в данных —
  // шаблоны SMS подставляют его, если оно уже заполнено.
  test("строки «Обращение» в «Личном» нет", () => {
    const personal = read("blocks/PersonalBlock.tsx");
    assert.doesNotMatch(personal, /label="Обращение"/);
    assert.doesNotMatch(personal, /update\(\{ sms_name/);
  });
});

describe("долг ведёт в «Неоплаченные»", () => {
  test("сводка при долге открывает историю с unpaid=1", () => {
    const card = read("ClientSummaryCard.tsx");
    assert.match(card, /debt\s*\?\s*\(\)\s*=>\s*router\.push\(/);
    assert.match(card, /unpaid: "1"/);
  });

  test("история читает unpaid=1 и отбирает правилом долга", () => {
    const visits = read("../../../app/(dashboard)/clients/visits.tsx");
    assert.match(visits, /unpaid === "1"/);
    assert.match(visits, /unpaidVisits\(appointments, today\)/);
    assert.match(visits, /"Неоплаченные"/);
  });
});

describe("метка и тег — плитками перед «Личным»", () => {
  // Владелец 22.09: «сделаем вот такие блоки — метка и теги», как «Команда |
  // Метка» в записи. Метка заходит сама с записи, пока её не выбрали руками.
  const tiles = () => read("ClientLabelTags.tsx");
  test("та же плитка, что в шапке записи", () => {
    assert.match(tiles(), /import \{ IdentityCard \} from "@\/features\/appointments\/TeamLabelRow"/);
    assert.equal((tiles().match(/<IdentityCard/g) ?? []).length, 2);
  });
  test("авто-метка подписана «по записи», ручная — нет", () => {
    assert.match(tiles(), /const labelAuto = !!label && !client\.city_manual;/);
    assert.match(tiles(), /sub=\{labelAuto \? "по записи" : undefined\}/);
    assert.match(tiles(), /onPick=\{\(name\) => update\(\{ city: name, city_manual: true \}\)\}/);
  });
  test("плитки стоят перед «Личным», а не в шапке", () => {
    const personal = read("blocks/PersonalBlock.tsx");
    assert.doesNotMatch(personal, /label="Метка"|label="Теги"/);
    // Владелец 22.09: «это не должно быть на первой странице» — плитки уехали
    // вниз, к «Личному».
    assert.match(read("ClientProfileBlocks.tsx"), /\{labelTags \?\? null\}\s*<PersonalBlock/);
    assert.doesNotMatch(read("ClientHeader.tsx"), /identity/);
  });
});

describe("тег один, как метка", () => {
  // Владелец 22.09: «в тегах убери кнопку „Применить“… выбирается один тег,
  // то же самое, как одна метка».
  test("шторка без «Применить», тап выбирает и закрывает", () => {
    const sheet = read("TagPickerSheet.tsx");
    assert.doesNotMatch(sheet, /label="Применить"|footer=/);
    assert.match(sheet, /onPick\(tag\.id\);\s*onClose\(\);/);
  });
  test("тап ставит один тег, тап по выбранному снимает", () => {
    assert.match(read("ClientLabelTags.tsx"), /const next = before\.length === 1 && before\[0\] === id \? \[\] : \[id\];/);
  });
});

describe("убираем свайпом, без вопросов", () => {
  // Владелец 22.09: «убрать связь можно свайпом вправо „Удалить“, как у нас
  // объекты, и в целом всё можно вот так вот убирать».
  test("связь, жилец и набор реквизитов уходят по свайпу сразу", () => {
    const links = read("blocks/ClientLinksBlock.tsx");
    assert.doesNotMatch(links, /confirmThen/);
    assert.match(links, /onAction=\{\(\) => \{\s*\/\/[\s\S]{0,200}suppressRoleCommit\(item\.key\);\s*onRemove\(item\);/);
    assert.doesNotMatch(read("ClientPeopleDoor.tsx"), /confirmThen/);
    const req = read("blocks/RequisitesBlock.tsx");
    assert.doesNotMatch(req, /confirmThen/);
    assert.match(req, /void writer\.removeRequisites\(set\.id\)\.then/);
  });
  test("…но с «Отменить» в подсказке (аудит 23.09)", () => {
    const req = read("blocks/RequisitesBlock.tsx");
    assert.match(req, /label: "Отменить"/);
    const door = read("ClientPeopleDoor.tsx");
    assert.match(door, /onPress: \(\) => void linkWriter\.restore\(item\)/);
    assert.match(read("use-link-writer.ts"), /restore\(item: ClientLinkItem\): Promise<boolean>;/);
  });
});

describe("заметки: клиента — наверху, объекта — под объектом", () => {
  // Владелец 22.09: «заметка клиента над блоком „Клиент“… и под каждым
  // объектом своя мини-заметка, как в записи».
  test("«Заметка клиента» стоит ВТОРЫМ блоком, под «Клиентом»", () => {
    // Владелец 23.09: «сначала идёт блок „Клиент", потом заметка клиента».
    const page = read("../../../app/(dashboard)/clients/[id].tsx");
    // Без «Клиенты: Меняет» заметка только читается (STORY-088, волна 4).
    assert.match(
      page,
      /note=\{<NotesBlock client=\{c\} update=\{update\} readOnly=\{!isDraft && !caps\.edit\} \/>\}/,
    );
    assert.match(read("ClientHeader.tsx"), /\{note \?\? null\}\s*\{people \?\? null\}/);
    assert.doesNotMatch(read("ClientProfileBlocks.tsx"), /<NotesBlock/);
  });
  test("у каждого объекта своя плашка заметки", () => {
    const objects = read("blocks/ObjectsBlock.tsx");
    assert.match(objects, /<ObjectNote loc=\{loc\} ownerKey=\{client\.id\} onSave=\{onNote\} \/>/);
    assert.match(objects, /useInlineNote<string>/);
    assert.match(objects, /placeholder="Заметка объекта"/);
    assert.match(
      read("ClientObjectsSection.tsx"),
      // Плашка — тому, кто правит карточку (STORY-088, волна 4).
      /onNote=\{\s*canEdit\s*\? \(id, next\) => void locationWriter\.patchLocation\(id, \{ note: next \|\| undefined \}\)\s*: undefined\s*\}/,
    );
  });
});

describe("длинные списки — своей страницей", () => {
  // Владелец 22.09: «нажимаю объекты — открывается страница, где все объекты;
  // если их 12, до файлов не долистаешь».
  test("на карточке первые три объекта и дверь «Все объекты»", () => {
    const section = read("ClientObjectsSection.tsx");
    assert.match(section, /export const OBJECTS_ON_CARD = 3;/);
    assert.match(read("ClientProfileBlocks.tsx"), /limit=\{OBJECTS_ON_CARD\}/);
    const objects = read("blocks/ObjectsBlock.tsx");
    assert.match(objects, /rest > 0 && onOpenAll \?/);
    assert.match(objects, /label="Все объекты"/);
  });
  test("страница всех объектов собрана тем же куском", () => {
    const page = read("../../../app/(dashboard)/clients/objects.tsx");
    assert.match(page, /<ClientObjectsSection/);
    assert.doesNotMatch(page, /limit=/);
    assert.match(read("../../../app/(dashboard)/clients/[id].tsx"), /pathname: "\/clients\/objects"/);
  });
});

describe("люди и реквизиты — тоже своими страницами", () => {
  // Владелец 22.09: «то же самое можно сделать с людьми и с реквизитами».
  test("на карточке первые строки и дверь «Все …»", () => {
    assert.match(read("ClientPeopleDoor.tsx"), /export const PEOPLE_ON_CARD = 3;/);
    assert.match(read("blocks/RequisitesBlock.tsx"), /export const REQUISITES_ON_CARD = 2;/);
    assert.match(read("blocks/RequisitesBlock.tsx"), /label="Все реквизиты"/);
    const page = read("../../../app/(dashboard)/clients/[id].tsx");
    assert.match(page, /label="Все люди"/);
    assert.match(page, /limit: PEOPLE_ON_CARD/);
    assert.match(page, /pathname: "\/clients\/people"/);
    assert.match(page, /pathname: "\/clients\/requisites"/);
  });
  test("страницы собраны теми же кусками", () => {
    assert.match(read("../../../app/(dashboard)/clients/people.tsx"), /useClientPeople\(\{/);
    assert.doesNotMatch(read("../../../app/(dashboard)/clients/people.tsx"), /limit:/);
    assert.match(read("../../../app/(dashboard)/clients/requisites.tsx"), /<RequisitesBlock/);
    assert.doesNotMatch(read("../../../app/(dashboard)/clients/requisites.tsx"), /limit=/);
  });
});

describe("аудит 23.09 — то, что чинили", () => {
  const page = () => read("../../../app/(dashboard)/clients/[id].tsx");
  test("поиск находит клиента по любому набору реквизитов", () => {
    const search = read("../../../../../packages/shared/src/local/selectors/client-search.ts");
    assert.match(search, /for \(const set of client\.requisites \?\? \[\]\) \{/);
  });
  test("двери подстраниц уносят компанию клиента", () => {
    assert.match(read("clients-company.ts"), /export function clientSubParams\(/);
    assert.match(page(), /pathname: "\/clients\/objects", params: clientSubParams\(id, scope\)/);
    assert.match(page(), /pathname: "\/clients\/requisites", params: clientSubParams\(id, scope\)/);
    assert.match(read("blocks/ClientFilesBlock.tsx"), /clientSubParams\(clientId, scope\)/);
  });
  test("объекты и люди на своей странице — с правами карточки", () => {
    assert.match(read("../../../app/(dashboard)/clients/objects.tsx"), /<ClientsCompanyRoute kind="card">/);
    assert.match(read("../../../app/(dashboard)/clients/people.tsx"), /<ClientsCompanyRoute kind="card">/);
  });
  test("неудачная правка откатывает только свои поля", () => {
    assert.match(read("queries.ts"), /const keys = Object\.keys\(variables\.patch\)/);
  });
  test("«Все файлы» видна, когда за ней только инвойсы и чеки", () => {
    assert.match(read("blocks/ClientFilesBlock.tsx"), /layout\.total > 0 \|\| layout\.hiddenPapers > 0/);
    const files = read("../../../app/(dashboard)/clients/attachments.tsx");
    assert.match(files, /docsCount === 0/);
    assert.match(files, /label="Инвойсы и чеки"/);
  });
  test("лист реквизитов закрывается, только когда записалось", () => {
    assert.match(read("RequisitesSheet.tsx"), /const ok = await onSave\(fieldsOf\(form\)\);\s*setSaving\(false\);\s*if \(!ok\) return;/);
  });
  test("на своей странице блок без второй шапки", () => {
    assert.match(read("blocks/ObjectsBlock.tsx"), /<SectionCard title=\{bare \? undefined : "Объекты"\}>/);
    assert.match(read("blocks/RequisitesBlock.tsx"), /<SectionCard title=\{bare \? undefined : "Реквизиты"\}>/);
  });
});

describe("«Отменить» после «Убрать» находит человека", () => {
  // Снято 23.09 на симуляторе: после «Убрать» строки человека уже нет в
  // перечне карточки-группы, и возврат молча сдавался.
  test("строка человека ищется и в общем списке клиентов", () => {
    assert.match(
      read("use-link-writer.ts"),
      /qc\.getQueriesData<Client\[\]>\(\{ queryKey: \["clients"\] \}\)/,
    );
  });
});

describe("«Отменить» возвращает связь по-настоящему", () => {
  // Снято 23.09 на симуляторе: возврат брал связи из строки кэша, где убранная
  // связь ещё числилась, — «уже есть», и ничего не писалось.
  test("возврат считается от последней своей записи", () => {
    assert.match(
      read("use-link-writer.ts"),
      /const base = queue\.latest \? \[\.\.\.queue\.latest\] : freshLinks\(queue, clientMemberships\(row\)\);/,
    );
    assert.match(read("use-link-writer.ts"), /detachedRows\.set\(ref\.memberId, row\);/);
  });
});
