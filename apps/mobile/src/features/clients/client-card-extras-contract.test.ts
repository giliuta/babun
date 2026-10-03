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
  // 03.10: «не надо в истории писать долг — просто последняя запись и
  // всё». Строки «Долг» в блоке нет; «Неоплаченные» остаются разрезом самой
  // истории (вход с `unpaid=1`).
  test("в блоке «История» карточки долга своей строкой нет", () => {
    const card = read("ClientSummaryCard.tsx");
    assert.doesNotMatch(card, /Долг \$\{/);
    assert.doesNotMatch(card, /unpaid: "1"/);
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
  test("плитки стоят самым верхом, перед блоком «Клиент» (03.10)", () => {
    const personal = read("blocks/PersonalBlock.tsx");
    assert.doesNotMatch(personal, /label="Метка"|label="Теги"/);
    // Владелец 03.10: «метку и тег поставим в самый верх перед блоком
    // „Клиент“» (22.09 они уезжали вниз, к «Личному»).
    const page = read("../../../app/(dashboard)/clients/[id].tsx");
    assert.match(page, /<ClientLabelTags[\s\S]{0,400}<ClientHeader/);
    assert.doesNotMatch(read("ClientProfileBlocks.tsx"), /labelTags/);
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
      // С 30.09 блок «Заметка» команда выключает на «Карточке клиента».
      /note=\{\s*noteOn \? \(\s*<NotesBlock client=\{c\} update=\{update\} readOnly=\{!access\.note\.edit\} \/>\s*\) : null\s*\}/,
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
  // 03.10: «видно только последний объект — обслуженный или добавленный;
  // нажимаю — страница со всеми».
  test("на карточке один объект, тап по нему — страница всех", () => {
    const section = read("ClientObjectsSection.tsx");
    assert.match(section, /cardObjectId\(client\.locations \?\? EMPTY_LOCATIONS, lastVisits\)/);
    assert.match(read("ClientProfileBlocks.tsx"), /single=\{!draft\}/);
    const objects = read("blocks/ObjectsBlock.tsx");
    assert.match(objects, /single \? onOpenAll : onOpen \? \(\) => onOpen\(loc\.id\) : undefined/);
    // «Все объекты» остаются у списка с пределом.
    assert.match(objects, /rest > 0 && onOpenAll \?/);
  });
  test("на странице объектов «Добавить объект» — кнопкой внизу", () => {
    const page = read("../../../app/(dashboard)/clients/objects.tsx");
    assert.match(page, /<GradientButton label="Добавить объект" onPress=\{\(\) => setAdding\(true\)\} \/>/);
    assert.match(page, /onAddingChange=\{setAdding\}/);
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
    // Реквизиты с 03.10 — как «История»: на карточке один набор, основной,
    // тап по нему — страница всех (двери «Все реквизиты» нет).
    assert.match(read("blocks/RequisitesBlock.tsx"), /const shown = single \? ordered\.slice\(0, 1\) : ordered;/);
    assert.match(read("ClientProfileBlocks.tsx"), /onOpenAll=\{draft \? undefined : onOpenRequisites\}/);
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
  test("инвойсы и чеки — в ленте файлов, а не за второй дверью (03.10)", () => {
    const files = read("../../../app/(dashboard)/clients/attachments.tsx");
    assert.match(read("use-client-files.ts"), /invoices: withDocs \? \(invoices\.data \?\? \[\]\) : \[\]/);
    assert.doesNotMatch(files, /label="Инвойсы и чеки"/);
  });
  test("лист реквизитов закрывается, только когда записалось", () => {
    assert.match(read("RequisitesSheet.tsx"), /const ok = await onSave\(fieldsOf\(form\)\);\s*setSaving\(false\);\s*if \(!ok\) return;/);
  });
  test("на своей странице блок без второй шапки", () => {
    assert.match(read("blocks/ObjectsBlock.tsx"), /<SectionCard title=\{bare \? undefined : "Объекты"\}>/);
    // Своя страница реквизитов (03.10) — плашки без карточки и шапки.
    assert.match(read("blocks/RequisitesBlock.tsx"), /if \(bare\) \{\s*return \(\s*<>/);
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
