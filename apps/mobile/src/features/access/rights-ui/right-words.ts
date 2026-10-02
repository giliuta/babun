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
  "calendar.create": "Новые записи",
  "calendar.move": "Перенос записей",
  "calendar.cancel": "Отмена и удаление",
  "calendar.events": "Записи событий",
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
  "record.status": "Статус",
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
  "finance.operations": "Доходы и расходы",
  "finance.accounts": "Счета",
  "finance.debts": "Долги",
  // «База клиентов» (владелец 01.10: «даём разрешение именно на базу, которая
  // в „Клиентах“») — до 01.10 «Карточки клиентов».
  clients: "База клиентов",
  // Бывшее «Какие клиенты» (владелец 02.10: «оставляем, только надо
  // переименовать»).
  "clients.scope": "Ограничение по времени",
  // Блоки карточки клиента — именами самих блоков карточки.
  "clients.note": "Заметка",
  "clients.people": "Люди",
  "clients.objects": "Объекты",
  "clients.labels": "Метка и тег",
  "clients.personal": "Личное",
  "clients.files": "Файлы",
  "clients.requisites": "Реквизиты",
  "clients.money": "Долг и деньги",
  // Настройки клиентов — именами строк шестерёнки клиентов (владелец 01.10).
  "clients.settings_card": "Карточка клиента",
  "clients.settings_ways": "Способы связи",
  "clients.settings_maps": "Карты для маршрута",
  "clients.settings_objects": "Типы объектов",
  "clients.settings_tags": "Теги клиентов",
  "company.sms_templates": "Шаблоны SMS",
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
  // События — так же, как записи клиентов (владелец 30.09).
  "calendar.events": { off: "Скрыты", read: "Только видит", write: "Видит и создаёт" },
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
  "record.status": { read: "Только видит", write: "Видит и меняет" },
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
  // Доходы и расходы в «Главном» «Календаря» (владелец 30.09: «то же самое —
  // видит, не видит, меняет»).
  "finance.operations": { off: "Скрыты", read: "Только видит", write: "Видит и меняет" },
  "finance.accounts": { off: "Не видит", read: "Видит", write: "Управляет" },
  "finance.debts": { off: "Не видит", read: "Видит", write: "Принимает оплату" },
  // КЛИЕНТЫ — ТЕМИ ЖЕ СЛОВАМИ, ЧТО «КАЛЕНДАРЬ» (владелец 30.09: страница
  // «Клиенты» — так же, блоками).
  // База — «Скрыта · Только видит · Редактирует» (владелец 02.10): видит —
  // открывает страницу и номер в окне «Какие клиенты»; редактирует —
  // заводит, правит и удаляет. Блоки карточки правятся своими правами.
  // «Открывает карточку» и «Телефон» убраны — их дают эти ступени.
  clients: { off: "Скрыта", read: "Только видит", write: "Редактирует" },
  // Защита базы (владелец 30.09): самое узкое — умолчание нового человека.
  // Окно едет вместе с днём (02.10): «2 недели» или «Месяц» до и после записи.
  // «Вся база» убрана (владелец 01.10: «сразу открывать доступ ко всей базе
  // нельзя, надо добавлять каждой команде»).
  // С 02.10 — «Ограничение по времени»: окно едет вместе с днём.
  "clients.scope": { near: "2 недели", month: "Месяц", own: "Без ограничения" },
  "clients.note": { off: "Скрыта", read: "Только видит", write: "Видит и меняет" },
  "clients.people": { off: "Скрыты", read: "Только видит", write: "Видит и меняет" },
  "clients.objects": { off: "Скрыты", read: "Только видит", write: "Видит и меняет" },
  "clients.labels": { off: "Скрыты", read: "Только видит", write: "Видит и меняет" },
  "clients.personal": { off: "Скрыто", read: "Только видит", write: "Видит и меняет" },
  "clients.files": { off: "Скрыты", read: "Только видит", write: "Видит и меняет" },
  "clients.requisites": { off: "Скрыты", read: "Только видит", write: "Видит и меняет" },
  "clients.money": { off: "Скрыты", read: "Видит" },
  // Настройки клиентов — как «Настройки команды» (владелец 01.10: «в
  // настройках он может редактировать или не может редактировать»).
  "clients.settings_card": { off: "Скрыта", read: "Только видит", write: "Видит и меняет" },
  "clients.settings_ways": { off: "Скрыты", read: "Только видит", write: "Видит и меняет" },
  "clients.settings_maps": { off: "Скрыты", read: "Только видит", write: "Видит и меняет" },
  "clients.settings_objects": { off: "Скрыты", read: "Только видит", write: "Видит и меняет" },
  "clients.settings_tags": { off: "Скрыты", read: "Только видит", write: "Видит и меняет" },
};

/** ОПАСНЫЕ СТУПЕНИ — одна строка предупреждения под пояснением (владелец
 *  29.09: «чтоб не переживал, что сотрудник может что-то украсть»). Только
 *  то, что уносит деньги, данные или записи насовсем. */
const DANGER: Record<string, Words> = {
  "calendar.cancel": { write: "Сможет удалять записи насовсем" },
  "finance.income": { full: "Сможет править и удалять чужие доходы" },
  "finance.expense": { full: "Сможет править и удалять чужие расходы" },
  "finance.operations": { write: "Сможет заводить и править деньги" },
  "finance.accounts": { write: "Сможет переводить деньги между счетами" },
  "finance.debts": { write: "Сможет удалять долги клиентов" },
  clients: { write: "Сможет удалять клиентов команды" },
  "clients.files": { write: "Сможет удалять файлы клиента" },
  "clients.settings_tags": { write: "Сможет удалять теги у всех клиентов команды" },
};

/** Имя строки права. */
export function rightTitle(block: Pick<AccessBlock, "key" | "title">): string {
  return TITLE[block.key] ?? block.title;
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

/** БЛОК КАРТОЧКИ МЕНЯЕТСЯ ВНУТРИ КАРТОЧКИ (30.09): «Видит и меняет» у блока
 *  при «Только видит» у «Карточек клиентов» этой команды сервер читает как
 *  «Только видит» (`access_client_blocks`). Строка показывает то, что человек
 *  получит, шторка — когда ступень заработает. */
const CARD_BLOCK_KEYS: ReadonlySet<string> = new Set([
  "clients.note",
  "clients.people",
  "clients.objects",
  "clients.labels",
  "clients.personal",
  "clients.files",
  "clients.requisites",
]);

function cappedByCard(block: Pick<AccessBlock, "key">, level: AccessLevel, context?: Context): boolean {
  return CARD_BLOCK_KEYS.has(block.key) && level === "write" && context !== undefined && context.clients !== "write";
}

/** Слово ступени НА СТРОКЕ: то, что человек получит на деле. */
export function rowWord(
  block: Pick<AccessBlock, "key" | "levels">,
  level: AccessLevel,
  context?: Context,
): string {
  if (cappedByCard(block, level, context)) return stepWord(block, "read", context);
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
  if (cappedByCard(block, level, context)) {
    return `${levelSentence(block.key, level)} — когда у «Карточек клиентов» «Видит и меняет»`;
  }
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
