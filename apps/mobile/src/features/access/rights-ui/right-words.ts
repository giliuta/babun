import type { AccessBlock, AccessLevel } from "../access-map";
import { levelSentence, segmentWord } from "../master-page/rights-copy";

// СЛОВА СТРОК ПРАВ — ЛЕСТНИЦЫ (владелец 29.09: «максимально лёгкий простой
// дизайн, чтобы можно было понимать, что как будет»). Каждая строка — одно
// право приложения, положения названы словами ИМЕННО ЭТОГО права и идут по
// возрастанию: «Клиент — Не видит · Видит · Выбирает», «Счета — Не видит ·
// Видит · Управляет». Общие «Не видит · Видит · Меняет» остаются запасом для
// права, которого ещё нет в словаре (реестр живёт на сервере и может обогнать
// сборку).

type Words = Partial<Record<AccessLevel, string>>;

/** Имя строки — короткое: раздел уже назван шапкой («Запись», «Финансы»). */
const TITLE: Record<string, string> = {
  "calendar.records": "Записи клиентов",
  // «Ограничения» записей (владелец 03.10: «как в клиентах»).
  "calendar.window": "Ограничения",
  "calendar.create": "Новые записи",
  "calendar.move": "Перенос записей",
  "calendar.cancel": "Отмена и удаление",
  "calendar.events": "Записи событий",
  // Полоса «Доход / Расход» под сеткой и лист «Финансы дня» (владелец 04.10:
  // «функция расход/доход должна быть в доступах календаря»).
  "calendar.day_money": "Доход и расход дня",
  "calendar.day_labels": "Метка дня",
  "calendar.schedule": "График команды",
  "calendar.identity": "Название и цвет",
  "calendar.timezone": "Часовой пояс",
  "calendar.hours": "Часы календаря",
  "calendar.booking_form": "Записи",
  "calendar.services": "Услуги",
  "calendar.labels": "Метки",
  "record.team": "Команда",
  "record.when": "Время",
  "record.label": "Метка",
  "record.color": "Цвет записи",
  "record.client": "Клиент",
  "record.object": "Объект",
  "record.services": "Услуги",
  "record.amount": "Цены",
  "record.payment": "Оплата",
  // Блок «SMS» внизу записи (владелец 03.10: «в записи SMS нужно добавить»).
  "record.sms": "SMS",
  "record.note": "Заметка",
  "record.files": "Файлы",
  // Блоки события — на вкладке «Событие» страницы «Запись».
  "event.label": "Метка",
  "event.type": "Тип",
  "event.client": "Клиент",
  "event.object": "Объект",
  "event.note": "Заметка",
  "event.files": "Файлы",
  "finance.income": "Доходы",
  "finance.expense": "Расходы",
  "finance.accounts": "Счета",
  "finance.debts": "Долги",
  // «Документы» вместо реестрового «Инвойсы и чеки»: так называется плитка
  // на странице финансов (владелец 03.10: права — по плиткам страницы).
  "finance.documents": "Документы",
  "finance.profit": "Прибыль",
  // «Ограничения» финансов (владелец 03.10) — то же слово, что у клиентов
  // и записей календаря.
  "finance.window": "Ограничения",
  // Строки шестерёнки финансов — её словами (03.10).
  "finance.settings_accounts": "Счета",
  "finance.settings_trash": "Удалённые операции",
  // Блок «Категории» шестерёнки — строки её видами (03.10).
  "finance.settings_categories_income": "Доходы",
  "finance.settings_categories_expense": "Расходы",
  "finance.settings_categories_debts": "Долги",
  "finance.settings_currency": "Валюта",
  "finance.settings_requisites": "Реквизиты",
  // «База клиентов» (владелец 01.10: «даём разрешение именно на базу, которая
  // в „Клиентах“») — до 01.10 «Карточки клиентов».
  clients: "База клиентов",
  // Бывшее «Какие клиенты» (владелец 02.10: «оставляем, только надо
  // переименовать», затем — «не „Ограничение по времени", а просто
  // „Ограничения"»).
  "clients.scope": "Ограничения",
  // Кнопка «Создать клиента» и меню по долгому нажатию / «⋯» (02.10);
  // удаление — своим правом, как «Отмена и удаление» в календаре (03.10).
  "clients.create": "Создание клиента",
  "clients.menu": "Меню клиента",
  "clients.delete": "Удаление клиента",
  // Блоки карточки клиента — именами самих блоков карточки.
  "clients.note": "Заметка",
  "clients.people": "Люди",
  "clients.objects": "Объекты",
  "clients.labels": "Метка",
  "clients.tags": "Тег",
  "clients.personal": "Личное",
  "clients.files": "Файлы",
  "clients.requisites": "Реквизиты",
  // Блоки страницы клиента (владелец 02.10: «чётко по блокам… история… в
  // конце SMS»).
  "clients.client": "Клиент",
  "clients.history": "История",
  "clients.sms": "SMS",
  // Настройки клиентов — именами строк шестерёнки клиентов (владелец 01.10).
  // Словами шестерёнки «Клиентов» (03.10) — строка права = её строка.
  "clients.settings_card": "Блоки клиентов",
  "clients.settings_ways": "Связь",
  "clients.settings_objects": "Типы объектов",
  "clients.settings_maps": "Карты для маршрута",
  "clients.settings_tags": "Теги",
  "clients.settings_sources": "Источники",
  "company.sms_templates": "Шаблоны SMS",
  // КАБИНЕТ (04.10) — именами строк Кабинета партнёра.
  "cabinet.tariff": "Тариф",
  "cabinet.tariff_payments": "Оплаты тарифа",
  "cabinet.sms": "SMS",
  "cabinet.history": "История изменений",
  // Директор (04.10): приглашает партнёров и ставит им права.
  "company.partners": "Партнёры",
};

/** Слова ступеней. Что не названо — берётся общее слово. */
const STEP: Record<string, Words> = {
  "calendar.create": { off: "Не может", write: "Может" },
  "calendar.move": { off: "Не может", write: "Может" },
  "calendar.cancel": { off: "Не может", write: "Может" },
  // Записи клиентов (владелец 30.09: «видит он записи, не видит вообще
  // записи и может ли создавать запись»). «Видит и создаёт» ставит заодно
  // «Новые записи» (`companionChanges`).
  "calendar.records": { off: "Скрыты", read: "Только видит", write: "Видит и создаёт" },
  // «Ограничения» записей (владелец 03.10: «как в клиентах такие же
  // ограничения… чтобы записи после какого-то времени он больше не мог их
  // видеть») — те же ступени, что у клиентов.
  "calendar.window": {
    week: "Неделя",
    near: "2 недели",
    month: "Месяц",
    quarter: "3 месяца",
    half: "Полгода",
    own: "Без ограничения",
  },
  // События — так же, как записи клиентов (владелец 30.09).
  "calendar.events": { off: "Скрыты", read: "Только видит", write: "Видит и создаёт" },
  // Как «Доходы» и «Расходы» финансов: «Добавляет» там — «вносит» здесь, словом
  // владельца («если он вписывает расходы за этот день»).
  "calendar.day_money": { off: "Скрыты", read: "Только видит", write: "Видит и вносит" },
  "calendar.schedule": { off: "Скрыт", read: "Только видит", write: "Видит и меняет" },
  // Настройки команды (владелец 30.09: «полностью как в шестерёнке»).
  "calendar.identity": { off: "Скрыто", read: "Только видит", write: "Видит и меняет" },
  "calendar.timezone": { off: "Скрыт", read: "Только видит", write: "Видит и меняет" },
  "calendar.hours": { off: "Скрыты", read: "Только видит", write: "Видит и меняет" },
  "calendar.booking_form": { off: "Скрыты", read: "Только видит", write: "Видит и меняет" },
  "calendar.services": { off: "Скрыты", read: "Только видит", write: "Видит и меняет" },
  "calendar.labels": { off: "Скрыты", read: "Только видит", write: "Видит и меняет" },
  // Метка дня (владелец 29.09: «не видит, видит, меняет — другими словами»).
  "calendar.day_labels": { off: "Скрыта", read: "Только видит", write: "Видит и меняет" },
  // БЛОКИ ЗАПИСИ — ТЕМИ ЖЕ СЛОВАМИ, ЧТО «КАЛЕНДАРЬ» (владелец 30.09: «что
  // может видеть, что не может видеть, что может редактировать»). Команда,
  // время и статус видны всегда — у них две ступени.
  "record.team": { read: "Только видит", write: "Видит и меняет" },
  "record.label": { off: "Скрыта", read: "Только видит", write: "Видит и меняет" },
  "record.when": { read: "Только видит", write: "Видит и меняет" },
  "record.color": { off: "Не может", write: "Может" },
  "record.client": { off: "Скрыт", read: "Только видит", write: "Видит и меняет" },
  "record.object": { off: "Скрыт", read: "Только видит", write: "Видит и меняет" },
  "record.services": { off: "Скрыты", read: "Только видит", write: "Видит и меняет" },
  "record.amount": { off: "Скрыты", read: "Видит" },
  "record.payment": { off: "Скрыта", read: "Только видит", write: "Видит и принимает" },
  "record.sms": { off: "Скрыты", read: "Видит" },
  "record.files": { off: "Скрыты", read: "Только видит", write: "Видит и добавляет" },
  "record.note": { off: "Скрыта", read: "Только видит", write: "Видит и меняет" },
  "event.label": { off: "Скрыта", read: "Только видит", write: "Видит и меняет" },
  "event.type": { off: "Скрыт", read: "Только видит", write: "Видит и меняет" },
  "event.client": { off: "Скрыт", read: "Только видит", write: "Видит и меняет" },
  "event.object": { off: "Скрыт", read: "Только видит", write: "Видит и меняет" },
  "event.note": { off: "Скрыта", read: "Только видит", write: "Видит и меняет" },
  "event.files": { off: "Скрыты", read: "Только видит", write: "Видит и добавляет" },
  // «Ведёт» — тем же словом, что в итоге команды («Ведёт доходы и расходы»,
  // «Ведёт своих клиентов»).
  // Доходы и расходы — два права с 30.09 (миграция 2а); слова — как у
  // остальных строк «Главного».
  "finance.income": { off: "Скрыты", read: "Только видит", write: "Видит и добавляет", full: "Видит и правит всё" },
  "finance.expense": { off: "Скрыты", read: "Только видит", write: "Видит и добавляет", full: "Видит и правит всё" },
  "finance.accounts": { off: "Не видит", read: "Видит", write: "Управляет" },
  "finance.debts": { off: "Не видит", read: "Видит", write: "Принимает оплату" },
  // Плитки «Документы» и «Прибыль» (владелец 03.10: «своё право»).
  "finance.documents": { off: "Скрыты", read: "Видит", write: "Выставляет" },
  "finance.profit": { off: "Скрыта", read: "Видит" },
  "finance.window": {
    week: "Неделя",
    near: "2 недели",
    month: "Месяц",
    quarter: "3 месяца",
    half: "Полгода",
    own: "Без ограничения",
  },
  // Строки шестерёнки финансов — как у шестерёнки клиентов.
  "finance.settings_accounts": { off: "Скрыты", read: "Только видит", write: "Видит и меняет" },
  // «Возвращает» — вернуть и стереть насовсем СВОЮ удалённую операцию.
  "finance.settings_trash": { off: "Скрыты", read: "Только видит", write: "Возвращает" },
  "finance.settings_categories_income": { off: "Скрыты", read: "Только видит", write: "Видит и меняет" },
  "finance.settings_categories_expense": { off: "Скрыты", read: "Только видит", write: "Видит и меняет" },
  "finance.settings_categories_debts": { off: "Скрыты", read: "Только видит", write: "Видит и меняет" },
  // Валюта, реквизиты и бланк инвойса — одни на весь аккаунт: партнёр их
  // только видит (правка ударила бы по деньгам и документам чужих команд).
  "finance.settings_currency": { off: "Скрыта", read: "Только видит" },
  "finance.settings_requisites": { off: "Скрыты", read: "Только видит" },
  // Кабинет (04.10): платит и пополняет — за ваш аккаунт, кнопкой с его
  // именем; смену тарифа и управление подпиской оставляет владельцу.
  "cabinet.tariff": { off: "Скрыт", read: "Только видит", write: "Оплачивает" },
  "cabinet.tariff_payments": { off: "Скрыты", read: "Только видит" },
  "cabinet.sms": { off: "Скрыт", read: "Только видит", write: "Пополняет" },
  "cabinet.history": { off: "Скрыта", read: "Только видит" },
  "company.partners": { off: "Скрыты", read: "Только видит", write: "Управляет" },
  // КЛИЕНТЫ — ТЕМИ ЖЕ СЛОВАМИ, ЧТО «КАЛЕНДАРЬ» (владелец 30.09: страница
  // «Клиенты» — так же, блоками).
  // База — «Скрыта · Видит» (владелец 02.10: «редактировать убираем… по
  // сути что там редактировать»). Заводить — «Создание клиента», убирать —
  // «Меню клиента», имя и номер — блок «Клиент» карточки.
  clients: { off: "Скрыта", read: "Только видит" },
  // Защита базы (владелец 30.09): самое узкое — умолчание нового человека.
  // Окно едет вместе с днём (02.10): «2 недели» или «Месяц» до и после записи.
  // «Вся база» убрана (владелец 01.10: «сразу открывать доступ ко всей базе
  // нельзя, надо добавлять каждой команде»).
  // С 02.10 — «Ограничение по времени»: окно едет вместе с днём.
  "clients.scope": {
    week: "Неделя",
    near: "2 недели",
    month: "Месяц",
    quarter: "3 месяца",
    half: "Полгода",
    own: "Без ограничения",
  },
  "clients.note": { off: "Скрыта", read: "Только видит", write: "Видит и меняет" },
  "clients.people": { off: "Скрыты", read: "Только видит", write: "Видит и меняет" },
  "clients.objects": { off: "Скрыты", read: "Только видит", write: "Видит и меняет" },
  "clients.labels": { off: "Скрыта", read: "Только видит", write: "Видит и меняет" },
  "clients.tags": { off: "Скрыт", read: "Только видит", write: "Видит и меняет" },
  "clients.personal": { off: "Скрыто", read: "Только видит", write: "Видит и меняет" },
  "clients.files": { off: "Скрыты", read: "Только видит", write: "Видит и меняет" },
  "clients.requisites": { off: "Скрыты", read: "Только видит", write: "Видит и меняет" },
  "clients.client": { off: "Скрыт", read: "Только видит", write: "Видит и меняет" },
  // Три положения (владелец 03.10): записи своих команд или всех.
  "clients.history": { off: "Скрыта", read: "Своя команда", write: "Все команды" },
  "clients.sms": { off: "Скрыты", read: "Только видит", write: "Видит и отправляет" },
  // Настройки клиентов — как «Настройки команды» (владелец 01.10: «в
  // настройках он может редактировать или не может редактировать»).
  "clients.settings_card": { off: "Скрыты", read: "Только видит", write: "Видит и меняет" },
  "clients.settings_ways": { off: "Скрыта", read: "Только видит", write: "Видит и меняет" },
  "clients.settings_objects": { off: "Скрыты", read: "Только видит", write: "Видит и меняет" },
  "clients.settings_maps": { off: "Скрыты", read: "Только видит", write: "Видит и меняет" },
  "clients.settings_tags": { off: "Скрыты", read: "Только видит", write: "Видит и меняет" },
  "clients.settings_sources": { off: "Скрыты", read: "Только видит", write: "Видит и меняет" },
};

/** ОПАСНЫЕ СТУПЕНИ — одна строка предупреждения под пояснением (владелец
 *  29.09: «чтоб не переживал, что сотрудник может что-то украсть»). Только
 *  то, что уносит деньги, данные или записи насовсем. */
const DANGER: Record<string, Words> = {
  "calendar.cancel": { write: "Сможет удалять записи насовсем" },
  "finance.income": { full: "Сможет править и удалять чужие доходы" },
  "finance.expense": { full: "Сможет править и удалять чужие расходы" },
  "finance.accounts": { write: "Сможет переводить деньги между счетами" },
  "finance.settings_accounts": { write: "Сможет заводить и удалять счета команды" },
  "finance.settings_trash": { write: "Сможет стирать свои удалённые операции насовсем" },
  "finance.debts": { write: "Сможет править и удалять долги" },
  "finance.documents": { write: "Сможет выставлять инвойсы от имени компании" },
  // Оплатит своей картой — и подписка аккаунта дальше списывается с неё.
  "cabinet.tariff": { write: "Подписка аккаунта будет списываться с его карты, пока вы её не смените" },
  // Директор: приглашает и убирает людей, но не выше своих прав и не себя.
  "company.partners": { write: "Сможет приглашать и убирать партнёров — с правами не выше своих" },

  "clients.delete": { write: "Сможет удалять клиентов команды" },
  "clients.sms": { write: "Сможет отправлять SMS клиентам — за счёт баланса" },
  "clients.files": { write: "Сможет удалять файлы клиента" },
  "clients.settings_tags": { write: "Сможет удалять теги у всех клиентов команды" },
  "clients.settings_sources": { write: "Клиенты удалённого источника останутся без источника" },
};

/** Имя строки права. */
export function rightTitle(block: Pick<AccessBlock, "key" | "title">): string {
  return TITLE[block.key] ?? block.title;
}

/** ИМЯ ПРАВА ВНЕ ЕГО БЛОКА — в подписи раздела «Доступ» («Финансы: доходы,
 *  расходы, категории доходов»). В своём блоке строка зовётся словом
 *  шестерёнки («Доходы» под шапкой «Категории»), а в одной строке-сводке
 *  такое слово повторяло плитку страницы: «доходы, расходы, доходы». */
const BRIEF_TITLE: Record<string, string> = {
  "finance.settings_accounts": "Настройки счетов",
  "finance.settings_categories_income": "Категории доходов",
  "finance.settings_categories_expense": "Категории расходов",
  "finance.settings_categories_debts": "Категории долгов",
};

export function briefTitle(block: Pick<AccessBlock, "key" | "title">): string {
  return BRIEF_TITLE[block.key] ?? rightTitle(block);
}

/** Положения соседних прав той же команды — там, где слово ступени зависит
 *  от соседа. */
type Context = Readonly<Record<string, AccessLevel>>;

/** «Счета: Не видит», когда он принимает оплату записи, — это ровно «Только
 *  при оплате» (владелец 29.09): счёт в оплате виден одним названием, без
 *  остатков и ленты (`list_payment_accounts_safe`). Отдельной ступени на
 *  сервере для этого нет — её и не нужно. */
function paysIntoAccounts(block: Pick<AccessBlock, "key">, level: AccessLevel, context?: Context): boolean {
  return block.key === "finance.accounts" && level === "off" && context?.["record.payment"] === "write";
}

/** Слово ступени НА СТРОКЕ: то, что человек получит на деле. */
export function rowWord(
  block: Pick<AccessBlock, "key" | "levels">,
  level: AccessLevel,
  context?: Context,
): string {
  // С 02.10 «Меняет» блока карточки работает своим правом, без «Меняет» у
  // базы, — на строке ступень как есть.
  return stepWord(block, level, context);
}

/** Слово ступени — на строке справа и крупно в шторке. */
export function stepWord(
  block: Pick<AccessBlock, "key" | "levels">,
  level: AccessLevel,
  context?: Context,
): string {
  if (paysIntoAccounts(block, level, context)) return "Только при оплате";
  return STEP[block.key]?.[level] ?? segmentWord(block.levels, level);
}

/** Пояснение ступени: что именно человек получит. */
export function stepHint(block: Pick<AccessBlock, "key">, level: AccessLevel, context?: Context): string {
  if (paysIntoAccounts(block, level, context)) return "Остатков не видит, счёт выбирает только в оплате записи";
  return levelSentence(block.key, level);
}

/** Предупреждение опасной ступени; `null` — ступень спокойная. */
export function stepDanger(block: Pick<AccessBlock, "key">, level: AccessLevel): string | null {
  return DANGER[block.key]?.[level] ?? null;
}

/** Ступень закрывает право целиком — слово на строке тише. */
export function isClosedStep(level: AccessLevel): boolean {
  return level === "off";
}

/** Ключи, у которых есть свои слова, — для сторожа словаря. */
export const WORDED_KEYS: readonly string[] = Object.keys(TITLE);
