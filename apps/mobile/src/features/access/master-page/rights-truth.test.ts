import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AccessBlock } from "../access-map";
import { mirrorMapOf } from "../mirror/mirror-map";
import {
  areaLevel,
  draftAccessChanges,
  draftLevel,
  emptyMasterDraft,
  isBlockFolded,
  visibleLevel,
  withLevel,
  type MasterDraft,
} from "./master-draft";
import { rightsSections } from "./rights-rows";

// ЧЕТЫРЕ ПОВЕРХНОСТИ ОБЯЗАНЫ ГОВОРИТЬ ОДНО И ТО ЖЕ.
//
// Владельцу право показывают четырьмя местами: строкой на странице, словом
// раздела на карточке, зеркалом «его глазами» и — главное — тем, что уходит
// на сервер. Пока свёртку зависимых блоков считал каждый сам, они врали, и
// врали молча. (Сводки «Сможет / Не сможет» сняты с карточки 21.09 по слову
// владельца: «это всё убирай, в правилах оставляем».)
//
// РЕЕСТР ЗДЕСЬ — НАСТОЯЩИЙ, снят с боевой базы (`access_blocks`); 21.09 волнами
// STORY-084 ожили оплата, статус, файлы, клиент и объект записи, а мешок
// «Категории, шаблоны, НДС» разошёлся на три отдельных блока.
// Это и есть суть теста: прежние проверки ставили `live` всем блокам сразу
// или никому, а беда живёт ровно в боевой форме — НЕЖИВОЙ родитель
// (`calendar.records`) над ЖИВЫМИ зависимыми (`finance.*`). На выдуманном
// реестре такой сторож зеленеет, ничего не охраняя.

const BLOCK: Record<string, AccessBlock> = {};
const REGISTRY: AccessBlock[] = (
  [
    ["calendar.records", "calendar", "calendar", ["off", "read", "write"], "Календарь и записи", false, false, 10],
    ["calendar.create", "calendar", "calendar", ["off", "write"], "Новые записи", false, false, 20],
    ["record.status", "calendar", "calendar", ["off", "read", "write"], "Статус записи", false, true, 30],
    // Волна 3: два положения — «видит или не видит» (слово владельца).
    ["record.client", "calendar", "calendar", ["off", "read"], "Клиент в записи", false, true, 34],
    ["record.object", "calendar", "calendar", ["off", "read"], "Объект в записи", false, true, 35],
    ["record.amount", "calendar", "calendar", ["off", "read", "write"], "Сумма записи", false, false, 40],
    // Живой с 21.09 (волна 1 STORY-084): деньги записи проверяет сервер.
    ["record.payment", "calendar", "calendar", ["off", "read", "write"], "Оплата в записи", false, true, 50],
    ["record.files", "calendar", "calendar", ["off", "read", "write"], "Фото и файлы записи", false, true, 55],
    ["calendar.day_labels", "calendar", "calendar", ["off", "read", "write"], "Метка дня", false, false, 60],
    ["calendar.settings", "calendar", "company", ["off", "read", "write"], "Настройки календаря", false, false, 70],
    ["finance.operations", "finance", "calendar", ["off", "read", "write"], "Доходы и расходы", false, true, 110],
    ["finance.accounts", "finance", "calendar", ["off", "read", "write"], "Счета и остатки", false, true, 120],
    ["finance.debts", "finance", "calendar", ["off", "read", "write"], "Долги", false, true, 130],
    ["finance.documents", "finance", "calendar", ["off", "read", "write"], "Инвойсы и чеки", false, false, 140],
    ["finance.categories", "finance", "company", ["off", "read", "write"], "Категории операций", false, false, 165],
    ["finance.templates", "finance", "company", ["off", "read", "write"], "Шаблоны операций", false, false, 170],
    ["finance.vat", "finance", "company", ["off", "read", "write"], "VAT", false, false, 175],
    ["clients", "clients", "company", ["off", "read", "write"], "Клиенты", false, true, 210],
    ["clients.scope", "clients", "company", ["own", "all"], "Какие клиенты", false, true, 220],
    ["clients.contacts", "clients", "company", ["off", "read"], "Телефоны и контакты", false, true, 230],
    ["services", "company", "company", ["off", "read", "write"], "Услуги и цены", false, false, 310],
    ["masters", "company", "company", ["off", "read", "write"], "Мастера", false, false, 320],
    ["company.currency", "company", "company", ["read", "write"], "Валюта", false, false, 330],
    ["company.profile", "company", "company", ["off", "read", "write"], "Реквизиты", false, false, 340],
    ["owner.access", "owner", "company", ["off"], "Приглашать сотрудников", true, false, 410],
    ["owner.billing", "owner", "company", ["off"], "Тариф и оплата", true, false, 420],
  ] as const
).map(([key, area, scope, levels, title, ownerOnly, live, position]) => {
  const block = {
    key,
    area,
    scope,
    levels: [...levels],
    title,
    ownerOnly,
    live,
    position,
  } as AccessBlock;
  BLOCK[key] = block;
  return block;
});

const TEAM = "team-1";
const TENANT = "tenant-1";

function draftWith(key: string, level: string): MasterDraft {
  const base = { ...emptyMasterDraft(TEAM), teamIds: [TEAM] };
  const block = BLOCK[key];
  assert.ok(block, `в реестре нет блока ${key}`);
  const teamId = block.scope === "calendar" ? TEAM : null;
  return withLevel(base, block, level as never, teamId);
}

/** Положение блока так, как его показывает СТРОКА страницы прав. */
function rowLevel(draft: MasterDraft, key: string): string | null {
  const sections = rightsSections(REGISTRY, visibleLevel(REGISTRY, draft), TEAM);
  for (const section of sections) {
    for (const row of section.rows) if (row.block.key === key) return row.level;
  }
  return null;
}

function sentLevel(draft: MasterDraft, key: string): string | null {
  const change = draftAccessChanges(REGISTRY, draft).find((item) => item.block === key);
  return change ? change.level : null;
}

describe("право, выданное владельцем, доходит до сервера целиком", () => {
  // Главный тест истории. «Доходы и расходы» — живой блок, но по реестру он
  // зависит от «Календаря и записей», а тот НЕ живой и строки на странице не
  // имеет. Пока свёртка смотрела на весь реестр, этот неживой родитель вечно
  // стоял на «Скрыт» и гасил выданное право: экран говорил «Меняет», на
  // сервер не уходило ничего, и поднять родителя было нельзя.
  test("«Доходы и расходы: Меняет» уходит, хотя неживой родитель скрыт", () => {
    const draft = draftWith("finance.operations", "write");
    assert.equal(rowLevel(draft, "finance.operations"), "write");
    assert.equal(sentLevel(draft, "finance.operations"), "write");
  });

  test("строка, слово раздела, сводка, зеркало и отправка совпадают", () => {
    const draft = draftWith("finance.operations", "write");

    assert.equal(rowLevel(draft, "finance.operations"), "write", "строка страницы");
    assert.equal(sentLevel(draft, "finance.operations"), "write", "уходит на сервер");
    // Раздел целиком — «Разное»: живых блоков в «Финансах» три, поднят один.
    assert.equal(areaLevel(REGISTRY, draft, "finance"), "mixed", "слово раздела");


    const map = mirrorMapOf(TENANT, REGISTRY, draft);
    assert.equal(map.calendars[TEAM]?.["finance.operations"], "write", "зеркало");
  });

  test("скрытые клиенты гасят телефоны во всех пяти местах сразу", () => {
    // Живой родитель — свёртка обязана работать: «Телефоны» без «Клиентов»
    // это право на то, чего человек не видит.
    let draft = draftWith("clients.contacts", "read");
    draft = withLevel(draft, BLOCK.clients as AccessBlock, "off", null);

    // Свёрнутая строка со страницы уходит совсем: право на то, чего человек
    // не видит, не предлагают.
    assert.equal(rowLevel(draft, "clients.contacts"), null, "строка страницы");
    assert.equal(sentLevel(draft, "clients.contacts"), null, "на сервер уходить нечему");


    const map = mirrorMapOf(TENANT, REGISTRY, draft);
    assert.notEqual(
      map.company["clients.contacts"],
      "read",
      "зеркало открывает телефоны, которых на сервере не будет",
    );
  });

  test("страница предлагает только живые блоки", () => {
    // «Клиенты» подняты: иначе их зависимые свёрнуты и проверять нечего.
    const draft = draftWith("clients", "write");
    const keys = rightsSections(REGISTRY, visibleLevel(REGISTRY, draft), TEAM)
      .flatMap((section) => section.rows)
      .map((row) => row.block.key);
    assert.deepEqual(
      keys.filter((key) => BLOCK[key]?.live !== true),
      [],
      "на странице стоит блок, которого сервер не проверяет",
    );
    // И живые при этом не потерялись: раздел «Клиенты» на месте целиком.
    for (const key of ["clients", "clients.scope", "clients.contacts"]) {
      assert.ok(keys.includes(key), `живой блок ${key} пропал со страницы`);
    }
  });

  // СТОРОЖ СТОРОЖА. Зелёный тест ещё не доказательство: надо показать, что он
  // умеет падать. Здесь прямо считается ПРЕЖНЕЕ правило свёртки — родитель
  // ищется во всём реестре, а не среди предлагаемых, — и проверяется, что на
  // этом же черновике оно давало ДРУГОЙ ответ. Значит проверки выше держат
  // настоящую разницу, а не совпадение.
  test("прежнее правило на этом же черновике гасило выданное право", () => {
    const draft = draftWith("finance.operations", "write");
    const byWholeRegistry = isBlockFolded("finance.operations", (parentKey) => {
      const parent = REGISTRY.find((block) => block.key === parentKey);
      return parent ? draftLevel(parent, draft, TEAM) : "write";
    });
    assert.equal(byWholeRegistry, true, "прежнее правило не сворачивало — тест ничего не охраняет");

    const byOfferedOnly = visibleLevel(REGISTRY, draft)(
      BLOCK["finance.operations"] as AccessBlock,
      TEAM,
    );
    assert.equal(byOfferedOnly, "write", "новое правило потеряло право");
  });

});
