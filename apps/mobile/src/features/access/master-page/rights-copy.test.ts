import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { LEVEL_WORD, type AccessBlock } from "../access-map";
import { hasSentences, levelSentence, offeredBlocks } from "./rights-copy";

const block = (over: Partial<AccessBlock>): AccessBlock => ({
  key: "clients",
  area: "clients",
  scope: "company",
  levels: ["off", "read", "write"],
  title: "Клиенты",
  ownerOnly: false,
  live: true,
  position: 210,
  ...over,
});

/** Реестр боевой базы на 21.09: ключи и уровни — как на сервере.
 *  Живых одиннадцать: волна 1 STORY-084 оживила оплату, волна 2 — статус и
 *  файлы, волна 3 — клиента и объект записи (у них два положения — слово
 *  владельца: «видит или не видит»). Мешок «Категории, шаблоны, НДС» снят. */
const REGISTRY: AccessBlock[] = [
  block({ key: "calendar.records", area: "calendar", scope: "calendar", live: false, title: "Календарь и записи" }),
  block({ key: "calendar.create", area: "calendar", scope: "calendar", levels: ["off", "write"], live: false, title: "Новые записи" }),
  block({ key: "record.status", area: "calendar", scope: "calendar", title: "Статус записи" }),
  block({ key: "record.client", area: "calendar", scope: "calendar", levels: ["off", "read"], title: "Клиент в записи" }),
  block({ key: "record.object", area: "calendar", scope: "calendar", levels: ["off", "read"], title: "Объект в записи" }),
  block({ key: "record.amount", area: "calendar", scope: "calendar", live: false, title: "Сумма записи" }),
  block({ key: "record.payment", area: "calendar", scope: "calendar", title: "Оплата в записи" }),
  block({ key: "record.files", area: "calendar", scope: "calendar", title: "Фото и файлы записи" }),
  block({ key: "calendar.day_labels", area: "calendar", scope: "calendar", live: false, title: "Метка дня" }),
  block({ key: "calendar.settings", area: "calendar", live: false, title: "Настройки календаря" }),
  block({ key: "finance.operations", area: "finance", scope: "calendar", title: "Доходы и расходы" }),
  block({ key: "finance.accounts", area: "finance", scope: "calendar", title: "Счета и остатки" }),
  block({ key: "finance.debts", area: "finance", scope: "calendar", title: "Долги" }),
  block({ key: "finance.documents", area: "finance", scope: "calendar", live: false, title: "Инвойсы и чеки" }),
  block({ key: "clients", title: "Клиенты" }),
  block({ key: "clients.scope", levels: ["own", "all"], title: "Какие клиенты" }),
  block({ key: "clients.contacts", levels: ["off", "read"], title: "Телефоны и контакты" }),
  block({ key: "services", area: "company", live: false, title: "Услуги и цены" }),
  block({ key: "masters", area: "company", live: false, title: "Мастера" }),
  block({ key: "company.currency", area: "company", levels: ["read", "write"], live: false, title: "Валюта" }),
  block({ key: "company.profile", area: "company", live: false, title: "Реквизиты" }),
  // Запись разобрана на блоки её формы (21.09) — имена те же, что в
  // «Кабинет → Запись».
  block({ key: "calendar.move", area: "calendar", scope: "calendar", levels: ["off", "write"], live: false, title: "Переносить и копировать записи" }),
  block({ key: "calendar.event_types", area: "calendar", live: false, title: "Типы событий" }),
  block({ key: "record.team", area: "calendar", scope: "calendar", live: false, title: "Команда и мастер записи" }),
  block({ key: "record.label", area: "calendar", scope: "calendar", live: false, title: "Метка записи" }),
  block({ key: "record.when", area: "calendar", scope: "calendar", live: false, title: "Время записи" }),
  block({ key: "record.services", area: "calendar", scope: "calendar", live: false, title: "Услуги в записи" }),
  // Заведены 21.09 (STORY-084): «каждый блок — свой переключатель». Все
  // спящие: сервер их ещё не проверяет, строки на странице нет.
  block({ key: "calendar.events", area: "calendar", scope: "calendar", live: false, title: "События" }),
  block({ key: "calendar.schedule", area: "calendar", scope: "calendar", live: false, title: "График команды" }),
  block({ key: "calendar.booking_form", area: "calendar", live: false, title: "Вид записи" }),
  block({ key: "finance.operation_files", area: "finance", scope: "calendar", live: false, title: "Файл к операции" }),
  block({ key: "finance.categories", area: "finance", live: false, title: "Категории операций" }),
  block({ key: "finance.templates", area: "finance", live: false, title: "Шаблоны операций" }),
  block({ key: "finance.vat", area: "finance", live: false, title: "VAT" }),
  block({ key: "finance.invoicing", area: "finance", live: false, title: "Счета клиентам" }),
  block({ key: "clients.filters", live: false, title: "Фильтры клиентов" }),
  block({ key: "clients.share", live: false, title: "Делиться клиентами" }),
  block({ key: "clients.money", levels: ["off", "read"], live: false, title: "Долг и визиты клиента" }),
  block({ key: "clients.history", levels: ["off", "read"], live: false, title: "История записей клиента" }),
  block({ key: "clients.files", live: false, title: "Файлы клиента" }),
  block({ key: "clients.archive", live: false, title: "Архив и корзина" }),
  block({ key: "clients.merge", levels: ["off", "write"], live: false, title: "Объединять дубли" }),
  block({ key: "clients.bulk_sms", levels: ["off", "write"], live: false, title: "Рассылка по выбранным" }),
  block({ key: "clients.import", levels: ["off", "write"], live: false, title: "Импорт клиентов" }),
  block({ key: "clients.flags", live: false, title: "Чёрный список и закрепление" }),
  block({ key: "masters.money", area: "company", levels: ["off", "read"], live: false, title: "Визиты и статистика мастера" }),
  block({ key: "company.sms_templates", area: "company", live: false, title: "Шаблоны SMS" }),
  block({ key: "company.inventory", area: "company", live: false, title: "Склад" }),
  block({ key: "owner.access", area: "owner", levels: ["off"], ownerOnly: true, live: false, title: "Приглашать сотрудников" }),
  block({ key: "owner.billing", area: "owner", levels: ["off"], ownerOnly: true, live: false, title: "Тариф и оплата" }),
];

describe("слова прав", () => {
  test("у каждого блока реестра есть фраза на каждое его положение", () => {
    for (const b of REGISTRY) {
      if (b.ownerOnly) continue; // владельческие строки на странице не стоят
      assert.ok(hasSentences(b.key), `нет фраз для блока ${b.key}`);
      for (const level of b.levels) {
        const sentence = levelSentence(b.key, level);
        assert.notEqual(sentence, LEVEL_WORD[level], `${b.key}/${level} остался термином`);
        assert.ok(sentence.length > 12, `${b.key}/${level}: фраза слишком короткая`);
      }
    }
  });

  test("фраза говорит про последствие, а не повторяет название", () => {
    assert.equal(
      levelSentence("record.amount", "off"),
      "Записи без денег: ни цены, ни долга",
    );
    assert.equal(
      levelSentence("clients.contacts", "off"),
      "Карточка без телефона, почты и мессенджеров",
    );
  });

  test("незнакомый блок не роняет экран и не врёт", () => {
    // Реестр живёт на сервере и может обогнать сборку: тогда строка говорит
    // словом положения, как раньше.
    assert.equal(levelSentence("future.block", "read"), LEVEL_WORD.read);
    assert.equal(hasSentences("future.block"), false);
  });

  test("страница предлагает только живые блоки", () => {
    const offered = offeredBlocks(REGISTRY);
    assert.deepEqual(
      offered.map((b) => b.key),
      // Порядок — как в реестре по `position`; волна 2 (21.09) оживила
      // «Статус записи» и «Фото и файлы записи», волна 3 — клиента и объект.
      [
        "record.status",
        "record.client",
        "record.object",
        "record.payment",
        "record.files",
        "finance.operations",
        "finance.accounts",
        "finance.debts",
        "clients",
        "clients.scope",
        "clients.contacts",
      ],
    );
  });

  test("владельческие блоки не предлагаются даже живыми", () => {
    const offered = offeredBlocks([block({ key: "owner.access", ownerOnly: true, live: true })]);
    assert.deepEqual(offered, []);
  });

  test("оживший блок появляется сам, без правки кода", () => {
    // Сторож против соблазна зашить список живых блоков в приложение.
    const withLiveCalendar = REGISTRY.map((b) =>
      b.key === "calendar.records" ? { ...b, live: true } : b,
    );
    assert.ok(offeredBlocks(withLiveCalendar).some((b) => b.key === "calendar.records"));
  });
});
