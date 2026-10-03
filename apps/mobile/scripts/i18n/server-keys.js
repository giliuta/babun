#!/usr/bin/env node
// SERVER TEXT — the Russian messages database functions raise (`raise exception
// 'Инвойс уже полностью оплачен'`) reach the screen as `error.message` and pass
// no babel plugin. This collects them from the LAST definition of every
// function in supabase/migrations into packages/shared/src/i18n/server-keys.json;
// `%` becomes a {N} slot, so «Платёж превышает остаток 50 EUR» is found by
// the key «Платёж превышает остаток {0} {1}». Plus the few messages edge
// functions write for people (EDGE_FUNCTION_MESSAGES). The runtime translates them where
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
const RAISE = /raise\s+exception\s+'((?:[^']|'')*)'/gi;
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

function collect() {
  const latest = new Map();
  for (const file of fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, file), "utf8");
    for (const m of sql.matchAll(FUNCTION)) latest.set(m[1], m[4]);
  }
  const keys = new Set([...EDGE_FUNCTION_MESSAGES, ...SEEDED_NAMES, ...ACCESS_BLOCK_TITLES]);
  for (const body of latest.values()) {
    for (const m of body.matchAll(RAISE)) if (CYRILLIC.test(m[1])) keys.add(toKey(m[1]));
  }
  return [...keys].sort();
}

if (require.main === module) {
  const keys = collect();
  fs.writeFileSync(OUT, JSON.stringify(keys, null, 1) + "\n");
  console.log(`${keys.length} server messages → ${path.relative(REPO, OUT)}`);
}

module.exports = { collect, toKey };
