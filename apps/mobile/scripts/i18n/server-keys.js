#!/usr/bin/env node
// SERVER TEXT — the Russian messages database functions raise (`raise exception
// 'Инвойс уже полностью оплачен'`) reach the screen as `error.message` and pass
// no babel plugin. This collects them from the LAST definition of every
// function in supabase/migrations into packages/shared/src/i18n/server-keys.json;
// `%` becomes a {N} slot, so «Платёж превышает остаток 50 EUR» is found by
// the key «Платёж превышает остаток {0} {1}». Plus the few messages edge
// functions write for people (EDGE_FUNCTION_MESSAGES), and the reasons the
// database writes into `sms_messages.error_message`. The runtime translates them where
// the app prints dynamic text (toasts, empty states) — see `tDynamic`.
//
//   node scripts/i18n/server-keys.js        rewrite server-keys.json
"use strict";

const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "../../..", "..");
const MIGRATIONS = path.join(REPO, "supabase/migrations");
const OUT = path.join(REPO, "packages/shared/src/i18n/server-keys.json");

const FUNCTION = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?([a-z_0-9]+)"?\s*\(([\s\S]*?)\$(\w*)\$([\s\S]*?)\$\3\$/gi;
// Both shapes of a raise: `raise exception 'текст'` and
// `raise exception using errcode = '…', message = 'текст'` — the second sets
// an SQLSTATE the client branches on, and its text reaches people the same way.
const RAISE = /raise\s+exception\s+(?:'((?:[^']|'')*)'|using\b[^;]*?\bmessage\s*=\s*'((?:[^']|'')*)')/gi;
// Why an SMS stayed unsent, written by the database into
// `sms_messages.error_message` — the SMS history prints it through `tDynamic`.
const ERROR_MESSAGE = /\berror_message\s*:?=\s*'((?:[^']|'')*)'/gi;
const CYRILLIC = /[А-Яа-яЁё]/;

// Edge functions write a few messages people read: why an SMS was not sent
// (`sms_messages.error`) and the SMS account alerts (card, refunds, disputes).
// Listed by hand — the rest of their Russian text goes to clients or Stripe.
const EDGE_FUNCTION_MESSAGES = [
  "Шаблон удалён или не заполнился полями записи",
  "Номер без кода страны",
  "У команды нет имени отправителя",
  "Текст длиннее {0} SMS",
  "На карте не хватило денег",
  "Срок карты истёк",
  "Банк просит подтвердить оплату — пополните баланс на сайте",
  "Банк отклонил карту",
  "Банк отклонил списание",
  "Платёж не прошёл",
  "{0}: валюта {1} вместо EUR — деньги не тронуты",
  "Оплата {0}: {1} ц. вместо {2} — не зачислена",
];

// Reasons set by a `case` into `sms_messages.error_message` — the scanner
// above reads only a literal right after `error_message =`.
const SMS_CASE_MESSAGES = ["Клиент удалён", "Клиент в чёрном списке", "Клиент просил не писать"];

// Raises a migration splices into a LIVE function body (pg_get_functiondef +
// exact replace, e.g. 20261004060000 for `update_invoice_draft`) are not in
// any `create function` text this scanner reads — listed by hand.
const PATCHED_FUNCTION_MESSAGES = [
  "Дата инвойса — в пределах {0} года: номер {1} из серии этого года",
  "Объект выбирают у клиента — сначала клиент",
  // 20261004091731: кредит-нота к чеку в `capture_invoice_document_snapshots`.
  "Кредит-нота должна ссылаться на чек этой компании",
  "Клиент кредит-ноты не совпадает с клиентом чека",
  // 20261004173942 + 20261004183011: право «Документы» в девяти функциях.
  "Нужно право «Документы: Выставляет» в команде документа",
  // 20261004211327: документ без реквизитов (новый аккаунт без набора).
  "Сначала добавьте реквизиты: Кабинет → Реквизиты",
  // 20261004224517: оплата записи с выставленным инвойсом — только по нему.
  "По записи выставлен инвойс {0} — примите оплату по нему",
];

/** `'Платёж превышает остаток % %'` → `Платёж превышает остаток {0} {1}`. */
function toKey(message) {
  let n = 0;
  return message
    .replace(/''/g, "'")
    .replace(/%%/g, "\u0000")
    .replace(/%/g, () => `{${n++}}`)
    .replace(/\u0000/g, "%");
}

// Rows the server seeds in Russian for every company and shows as they are:
// the standard client sources (rows with `key`) and the server's own finance
// categories (`is_system`). The app translates them when it reads or prints
// them (`sourceDisplayName`, `rowToCategory`).
const SEEDED_NAMES = [
  "Рекомендация",
  "Сайт",
  "Повторный",
  "Проездом",
  "Другое",
  "Услуги",
  "Возврат",
  "Комиссия банка",
  "Связь и интернет",
  "Еда",
  "Топливо",
  "Товары",
  "Страховка",
  "Реклама",
  "Иное",
  "Аренда",
  "Зарплата",
  "Субподряд",
  "Материалы",
  "Налоги и сборы",
  "Чаевые",
  "Инструмент",
  "Машина и ремонт",
];

// Titles of the rights blocks (`access_blocks.title_ru`) — the rights pages
// and refusals name a block by them.
const ACCESS_BLOCK_TITLES = [
  "Архив и корзина",
  "Блоки клиентов",
  "Валюта",
  "Визиты и статистика мастера",
  "Время записи",
  "Выгрузка для бухгалтера",
  "График команды",
  "Делиться клиентами",
  "Документы",
  "Долги",
  "Доходы",
  "Заметка",
  "Заметка записи",
  "Заметка события",
  "Записи",
  "Записи клиентов",
  "Импорт клиентов",
  "Инвойсы",
  "История",
  "Источники",
  "Карты для маршрута",
  "Клиент",
  "Клиент в записи",
  "Клиент события",
  "Клиенты",
  "Команда и мастер записи",
  "Личное",
  "Люди",
  "Мастера",
  "Меню клиента",
  "Метка",
  "Метка дня",
  "Метка записи",
  "Метка события",
  "Метки",
  "Название и цвет",
  "Настройки календаря",
  "Новые записи",
  "Объединять дубли",
  "Объект в записи",
  "Объект события",
  "Объекты",
  "Ограничения",
  "Оплата в записи",
  "Отменять и удалять записи",
  "Переносить и копировать записи",
  "Прибыль",
  "Приглашать сотрудников",
  "Рассылка по выбранным",
  "Расходы",
  "Реквизиты",
  "Связь",
  "Склад",
  "События",
  "Создание клиента",
  "Статус записи",
  "Сумма и услуги записи",
  "Счета",
  "Тариф и оплата",
  "Тег",
  "Теги",
  "Тип события",
  "Типы объектов",
  "Типы событий",
  "Удаление клиента",
  "Удалённые операции",
  "Услуги",
  "Услуги в записи",
  "Услуги и цены",
  "Файлы",
  "Файлы события",
  "Фильтры клиентов",
  "Фото и файлы записи",
  "Цвет записи",
  "Часовой пояс",
  "Часы календаря",
  "Чёрный список и закрепление",
  "Шаблоны SMS",
];

// A later `drop function` retires the messages too: a dropped function raises
// nothing, and its phrases would sit untranslated forever (the «Личное и
// Компании» guards after the 12.10 revert). But migrations also drop an OLD
// signature and `execute` a patched live body under the same name — a body
// this scanner never sees. So a name is retired only when a drop is the LAST
// mention of it in all migrations: a later grant, revoke, `::regprocedure` or
// redefinition means the function lives on.
const DROP = /drop\s+function\s+(?:if\s+exists\s+)?(?:public\.)?"?([a-z_0-9]+)"?[^;]*;/gi;

function collect() {
  const latest = new Map();
  /** name → was its last mention a drop statement */
  const lastIsDrop = new Map();
  for (const file of fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, file), "utf8");
    for (const m of sql.matchAll(FUNCTION)) latest.set(m[1], m[4]);
    const drops = [...sql.matchAll(DROP)].map((m) => ({ name: m[1], from: m.index, to: m.index + m[0].length }));
    for (const name of latest.keys()) {
      let last = -1;
      for (const m of sql.matchAll(new RegExp(`\\b${name}\\b`, "g"))) last = m.index;
      if (last < 0) continue;
      lastIsDrop.set(name, drops.some((d) => d.name === name && d.from <= last && last < d.to));
    }
  }
  const keys = new Set([
    ...EDGE_FUNCTION_MESSAGES,
    ...SMS_CASE_MESSAGES,
    ...PATCHED_FUNCTION_MESSAGES,
    ...SEEDED_NAMES,
    ...ACCESS_BLOCK_TITLES,
  ]);
  for (const [name, body] of latest) {
    if (lastIsDrop.get(name)) continue;
    for (const m of body.matchAll(RAISE)) {
      const text = m[1] ?? m[2];
      if (CYRILLIC.test(text)) keys.add(toKey(text));
    }
    for (const m of body.matchAll(ERROR_MESSAGE)) {
      if (CYRILLIC.test(m[1])) keys.add(m[1].replace(/''/g, "'"));
    }
  }
  return [...keys].sort();
}

if (require.main === module) {
  const keys = collect();
  fs.writeFileSync(OUT, JSON.stringify(keys, null, 1) + "\n");
  console.log(`${keys.length} server messages → ${path.relative(REPO, OUT)}`);
}

module.exports = { collect, toKey };
