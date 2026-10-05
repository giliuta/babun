// «ПОМОЩЬ» — КОНТАКТЫ ПОДДЕРЖКИ И ЧАСТЫЕ ВОПРОСЫ (Кабинет, 03.10).
//
// Владелец 03.10: «помощь, связь с поддержкой — да, надо». Файл чистый: ни React,
// ни RN — ссылки и список вопросов проверяются тестом, а экран только рисует.
//
// КОНТАКТЫ — ТОЛЬКО НАЗВАННЫЕ ВЛАДЕЛЬЦЕМ. Почту поддержки он назвал 04.10
// («babun.app@gmail.com — почта от приложения, специально создал»); с 04.10
// наружу смотрит адрес домена support@babun.app — Cloudflare Email Routing
// пересылает его в тот же ящик (проверено: письмо Google «Forwarded»). Номер и ник
// выдумывать нельзя: строка-дверь в чужой номер — худший вид вранья (закон
// `SettingsRow.onPress`). Пустой канал — строки нет вовсе, без заглушек и без
// «скоро»; заполнил — строка появилась сама. Та же почта стоит в документах
// (`features/legal/operator.ts`).

export interface SupportContacts {
  /** Номер для WhatsApp в любом виде: «+357 99 123 456». */
  whatsapp: string;
  /** Ник в Telegram, с «@» или без. */
  telegram: string;
  email: string;
}

export const SUPPORT_CONTACTS: SupportContacts = {
  whatsapp: "",
  telegram: "",
  email: "support@babun.app",
};

export type SupportChannel = "whatsapp" | "telegram" | "email";

export interface SupportRow {
  channel: SupportChannel;
  /** Название канала для строки. */
  title: string;
  /** Контакт так, как его читает человек: номер, «@ник», адрес. */
  sub: string;
  /** Значение для сборки ссылки: уже обрезанное по краям. */
  value: string;
}

/** Только цифры: wa.me не принимает «+», пробелов и скобок. */
function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

/** Ник без «@» и пробелов по краям. */
function telegramUsername(value: string): string {
  return value.trim().replace(/^@+/, "").trim();
}

/** `https://wa.me/35799123456`. */
export function whatsappLink(number: string): string {
  return `https://wa.me/${digitsOnly(number)}`;
}

/** `https://t.me/babun_support`. */
export function telegramLink(username: string): string {
  return `https://t.me/${telegramUsername(username)}`;
}

/** Тело письма: версия и устройство уже стоят, ниже — пустая строка под вопрос.
 *  Версию говорит экран — здесь нет ни нативных модулей, ни констант сборки. */
export function supportMailBody(appVersion: string): string {
  return `Версия приложения: ${appVersion}\nУстройство: iPhone\n\n`;
}

/** `mailto:` с темой и заготовкой письма. Адрес в ссылке — как есть, тема и
 *  тело — через `encodeURIComponent` (кириллица, переводы строк). */
export function emailLink(email: string, appVersion: string): string {
  const subject = encodeURIComponent("Вопрос по Babun");
  const body = encodeURIComponent(supportMailBody(appVersion));
  return `mailto:${email.trim()}?subject=${subject}&body=${body}`;
}

/** Строки раздела «Связаться»: только каналы с пригодным контактом. Номер без
 *  единой цифры и ник из одних «@» дали бы ссылку в пустоту — такие не считаются. */
export function supportRows(contacts: SupportContacts): SupportRow[] {
  const rows: SupportRow[] = [];

  const whatsapp = contacts.whatsapp.trim();
  if (digitsOnly(whatsapp)) {
    rows.push({ channel: "whatsapp", title: "WhatsApp", sub: whatsapp, value: whatsapp });
  }

  const username = telegramUsername(contacts.telegram);
  if (username) {
    rows.push({ channel: "telegram", title: "Telegram", sub: `@${username}`, value: username });
  }

  const email = contacts.email.trim();
  if (email) {
    rows.push({ channel: "email", title: "Почта", sub: email, value: email });
  }

  return rows;
}

/** Ссылка строки «Связаться». Версия нужна только письму. */
export function supportLink(row: SupportRow, appVersion: string): string {
  switch (row.channel) {
    case "whatsapp":
      return whatsappLink(row.value);
    case "telegram":
      return telegramLink(row.value);
    case "email":
      return emailLink(row.value, appVersion);
  }
}

export interface HelpFaqItem {
  id: string;
  question: string;
  answer: string;
}

// ЧАСТЫЕ ВОПРОСЫ. Только то, что в продукте есть сегодня, и словами продукта:
// каждый ответ называет путь до экрана («Кабинет → Тариф»), а не пересказывает
// функцию. Новый пункт добавляется, когда экран уже на месте.
export const HELP_FAQ: readonly HelpFaqItem[] = [
  {
    id: "teams",
    question: "Как добавить команду?",
    answer:
      "У каждой команды свой календарь. Новая команда добавляется через шестерёнку календаря → «Добавить». Часы, график, записи, услуги, метки и SMS у каждой команды свои.",
  },
  {
    id: "partners",
    question: "Как пригласить партнёра?",
    answer:
      "Кабинет → Партнёры. Права ставятся по каждой команде и по каждому блоку: «Скрыт», «Только видит» или «Видит и меняет». У партнёра свой аккаунт.",
  },
  {
    id: "clients",
    question: "Где настройки клиентов?",
    answer:
      "База клиентов у каждой команды своя. Настройки — за шестерёнкой на вкладке «Клиенты»: блоки клиентов, связь, типы объектов, карты, теги, источники.",
  },
  {
    id: "finance",
    question: "Что есть в финансах?",
    answer:
      "Доходы, расходы, переводы, долги, инвойсы и чеки. Настройки финансов — за шестерёнкой на вкладке «Финансы».",
  },
  {
    id: "sms",
    question: "Как работают SMS?",
    answer:
      "Баланс и пополнение — Кабинет → SMS. Шаблоны и имя отправителя у каждой команды свои: шестерёнка календаря → SMS. Одна часть SMS стоит €0,12.",
  },
  {
    id: "tariff",
    question: "Сколько стоит тариф?",
    answer:
      "Соло €6.99, Про €29.99, Макс €59.99 в месяц. Есть пробный период — 14 дней. Сменить тариф можно в Кабинет → Тариф, оплата проходит на странице Stripe в браузере.",
  },
  {
    id: "offline",
    question: "Что, если нет интернета?",
    answer:
      "Изменения сохраняются на телефоне и отправляются, когда связь вернётся. Владелец видит очередь в Кабинет → Синхронизация.",
  },
  {
    id: "archive",
    question: "Как вернуть удалённый календарь?",
    answer:
      "Удалённый календарь попадает в Кабинет → Архив. Оттуда его можно восстановить или стереть навсегда.",
  },
  {
    id: "history",
    question: "Где посмотреть, кто что менял?",
    answer:
      "Кабинет → История изменений: кто и что изменил во всех командах. Историю видит владелец аккаунта.",
  },
  {
    id: "notifications",
    question: "Как настроить напоминания?",
    answer:
      "Кабинет → Уведомления: напоминания о записях и клиентах для каждой команды.",
  },
  {
    id: "export",
    question: "Как выгрузить данные?",
    answer:
      "Кабинет → Выгрузка данных: клиенты, записи и финансы ваших команд выгружаются в CSV.",
  },
];

/** Вопросы, которые говорят об оплате: в приложении из магазина их нет
 *  (владелец 04.10, `lib/pay-here.ts` — ни цены-предложения, ни «где
 *  платить»). На сайте — все. */
const PAYMENT_FAQ_IDS: ReadonlySet<string> = new Set(["tariff"]);

/** SMS без слова «пополнение» — для приложения из магазина. */
const SMS_ANSWER_NO_PAY =
  "Баланс — Кабинет → SMS. Шаблоны и имя отправителя у каждой команды свои: шестерёнка календаря → SMS.";

/** Частые вопросы для платформы: `payHere` — `CAN_PAY_HERE`. */
export function helpFaq(payHere: boolean): readonly HelpFaqItem[] {
  if (payHere) return HELP_FAQ;
  return HELP_FAQ.filter((item) => !PAYMENT_FAQ_IDS.has(item.id)).map((item) =>
    item.id === "sms" ? { ...item, answer: SMS_ANSWER_NO_PAY } : item,
  );
}

/** Документы — строки «Помощи» и адреса сайта без входа (04.10). */
export const LEGAL_LINKS = [
  { href: "/privacy", title: "Политика конфиденциальности" },
  { href: "/terms", title: "Условия использования" },
  { href: "/delete-account", title: "Удаление аккаунта" },
] as const;
