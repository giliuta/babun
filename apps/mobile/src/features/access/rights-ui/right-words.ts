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
  "calendar.create": "Новые записи",
  "calendar.move": "Перенос записей",
  "calendar.cancel": "Отмена и удаление",
  "calendar.events": "События",
  "calendar.day_labels": "Метка дня",
  "calendar.schedule": "График команды",
  "record.team": "Команда",
  "record.label": "Метка",
  "record.color": "Цвет записи",
  "record.client": "Клиент",
  "record.object": "Объект",
  "record.services": "Услуги",
  "record.amount": "Цены",
  "record.payment": "Оплата",
  "record.status": "Статус и заметка",
  "record.files": "Файлы",
  "finance.income": "Доходы",
  "finance.expense": "Расходы",
  "finance.operations": "Доходы и расходы",
  "finance.accounts": "Счета",
  "finance.debts": "Долги",
  clients: "Карточки клиентов",
  "clients.scope": "Какие клиенты",
  "clients.contacts": "Телефоны",
  "company.sms_templates": "Шаблоны SMS",
};

/** Слова ступеней. Что не названо — берётся общее слово. */
const STEP: Record<string, Words> = {
  "calendar.create": { off: "Не может", write: "Может" },
  "calendar.move": { off: "Не может", write: "Может" },
  "calendar.cancel": { off: "Не может", write: "Может" },
  // Метка дня (владелец 29.09: «не видит, видит, меняет — другими словами»).
  "calendar.day_labels": { off: "Скрыта", read: "Только видит", write: "Видит и меняет" },
  "record.team": { read: "Видит", write: "Меняет" },
  "record.label": { off: "Не видит", read: "Видит", write: "Ставит" },
  "record.color": { off: "Не может", write: "Может" },
  "record.client": { off: "Не видит", read: "Видит", write: "Выбирает" },
  "record.object": { off: "Не видит", read: "Видит", write: "Выбирает" },
  "record.services": { off: "Не видит", read: "Видит" },
  "record.payment": { off: "Не видит", read: "Видит", write: "Принимает" },
  "record.status": { read: "Видит", write: "Меняет" },
  "record.files": { off: "Не видит", read: "Видит", write: "Добавляет" },
  // «Ведёт» — тем же словом, что в итоге команды («Ведёт доходы и расходы»,
  // «Ведёт своих клиентов»).
  "finance.income": { off: "Не видит", read: "Видит", write: "Добавляет", full: "Правит всё" },
  "finance.expense": { off: "Не видит", read: "Видит", write: "Добавляет", full: "Правит всё" },
  "finance.operations": { off: "Не видит", read: "Видит", write: "Ведёт" },
  "finance.accounts": { off: "Не видит", read: "Видит", write: "Управляет" },
  "finance.debts": { off: "Не видит", read: "Видит", write: "Принимает оплату" },
  clients: { off: "Не видит", read: "Видит", write: "Ведёт" },
  "clients.scope": { own: "Только своих", all: "Всех" },
  "clients.contacts": { off: "Скрыты", read: "Видит" },
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
  "clients.scope": { all: "Откроется вся база клиентов компании" },
  "clients.contacts": { read: "Сможет звонить и писать клиентам со своего телефона" },
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
