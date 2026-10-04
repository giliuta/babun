// ТЕКСТЫ ДОКУМЕНТОВ: ПОЛИТИКА, УСЛОВИЯ, УДАЛЕНИЕ АККАУНТА (04.10).
//
// Нужны для выпуска в App Store и Google Play: обе витрины требуют живую
// ссылку на политику конфиденциальности, Google — ещё и страницу «как удалить
// аккаунт». Открываются без входа: babun.app/privacy, /terms, /delete-account.
//
// Два языка, а не семь: юридический текст переводит человек, а не словарь
// интерфейса. Русский — язык продукта, английский читает проверяющий Apple и
// Google. Поэтому русский текст помечен `i18n-ignore`: babel-плагин не должен
// искать его в словаре.
//
// Разметка простая и разбирается `parseLegal`: «# » — заголовок документа,
// «## » — раздел, «- » — пункт списка, пустая строка — новый абзац.
// {NAME}, {ADDRESS}, {EMAIL} подставляются из `operator.ts`.
//
// Каждое утверждение здесь сверено с кодом на 04.10: что хранится, кому
// передаётся, что стирает удаление (`supabase/functions/account-delete`).
// Поменялся продукт — правится и текст, и дата «Обновлено».

export type LegalDocId = "privacy" | "terms" | "delete-account";
export type LegalLang = "ru" | "en";

const PRIVACY_RU = /* i18n-ignore */ `# Политика конфиденциальности
Обновлено 4 октября 2026

Babun — CRM для сервисного бизнеса: календарь записей, клиенты, объекты, финансы и SMS. Сервис предоставляет {NAME} ({ADDRESS}). Вопросы о данных — {EMAIL}.

## Две роли
Данные вашего аккаунта (почта, имя, настройки) мы обрабатываем как владелец сервиса.

Данные, которые вы ведёте в Babun о своих клиентах (имена, телефоны, адреса, объекты, фото, заметки, записи, деньги), принадлежат вам. Для них вы — контролёр данных, а мы обрабатываем их только по вашему поручению: чтобы хранить, показывать вам и вашим партнёрам и отправлять SMS, которые вы просите отправить.

## Что мы собираем
- Аккаунт: почта, пароль (храним только в зашифрованном виде), имя, часовой пояс, язык.
- Ваша работа: команды, календари, записи, клиенты, объекты, услуги, файлы и фото, заметки, операции, инвойсы, шаблоны SMS.
- Контакты телефона — только когда вы сами открываете импорт. Список читается на телефоне, в Babun попадают лишь те контакты, которые вы отметили.
- Камера и фото — только когда вы сами снимаете или выбираете снимок объекта или документа.
- Местоположение — только когда ваш клиент сам отправляет точку по ссылке «Куда приехать».
- Оплаты: тариф, сроки подписки и история платежей. Номер карты вводится на странице Stripe — мы его не видим и не храним.
- Технические данные: модель устройства, версия приложения, отчёты об ошибках. В отчёты не попадают имена и телефоны ваших клиентов.

Рекламы, рекламных идентификаторов и слежки между приложениями в Babun нет. Данные не продаются.

## Зачем
- чтобы сервис работал: вход, синхронизация между устройствами, работа без интернета, доступ партнёров;
- чтобы отправлять SMS вашим клиентам, когда вы это включили;
- чтобы принимать оплату тарифа и баланса SMS;
- чтобы находить и чинить ошибки и защищать аккаунты.

Основания по GDPR: исполнение договора с вами, законный интерес (безопасность и исправление ошибок) и закон (бухгалтерия по платежам).

## Кому передаются данные
Только подрядчикам, без которых сервис не работает, и только в нужном объёме:
- Supabase — база данных, вход и хранение файлов;
- Vercel — сайт babun.app;
- Expo — доставка обновлений приложения;
- Stripe — приём оплат;
- Twilio — отправка SMS (номер получателя и текст сообщения);
- Sentry — отчёты об ошибках.

Часть подрядчиков может обрабатывать данные вне ЕС — по стандартным договорным условиям ЕС. Партнёры, которых вы пригласили, видят только те команды и блоки, к которым вы дали доступ.

## Сколько храним
Пока аккаунт существует. После удаления аккаунта данные стираются (подробно — на странице babun.app/delete-account). Резервные копии базы перезаписываются в течение 7 дней. Записи о платежах Stripe хранит столько, сколько требует закон.

## Ваши права
Вы можете узнать, какие данные о вас хранятся, исправить их, выгрузить (Кабинет → Выгрузка данных), удалить аккаунт (Кабинет → Вход и безопасность → Удалить аккаунт), возразить против обработки и подать жалобу в надзорный орган — на Кипре это Уполномоченный по защите персональных данных (dataprotection.gov.cy). Клиенты наших пользователей обращаются к тому бизнесу, который ведёт их в Babun; мы поможем ему ответить.

## Безопасность
Соединения шифруются, у каждого аккаунта своя изолированная база команд, доступ партнёров настраивается по блокам. Ни одна система не защищена полностью, но о серьёзной утечке мы сообщим вам и надзорному органу, как требует закон.

## Дети
Babun — инструмент для работы и не предназначен для детей младше 16 лет.

## Изменения
О существенных изменениях этой политики мы сообщим в приложении или по почте. Дата наверху — дата последней правки.

## Связь
{NAME}, {ADDRESS}, {EMAIL}`;

const PRIVACY_EN = `# Privacy Policy
Last updated: October 4, 2026

Babun is a CRM for service businesses: appointment calendar, clients, sites, finances and SMS. The service is provided by {NAME} ({ADDRESS}). Questions about your data: {EMAIL}.

## Two roles
We process your account data (email, name, settings) as the provider of the service.

The data you keep in Babun about your own customers (names, phone numbers, addresses, sites, photos, notes, appointments, money) belongs to you. You are the data controller for it, and we process it only on your instructions: to store it, show it to you and the partners you invite, and send the SMS you ask us to send.

## What we collect
- Account: email, password (stored only as a secure hash), name, time zone, language.
- Your work: teams, calendars, appointments, clients, sites, services, files and photos, notes, transactions, invoices, SMS templates.
- Phone contacts — only when you open the import yourself. The list is read on your phone; only the contacts you select are added to Babun.
- Camera and photos — only when you take or pick a photo of a site or a document.
- Location — only when your customer sends a pin through a "Where to come" link.
- Payments: plan, subscription dates and payment history. Card numbers are entered on Stripe's page; we never see or store them.
- Technical data: device model, app version, crash reports. Crash reports do not include your customers' names or phone numbers.

Babun has no ads, no advertising identifiers and no cross-app tracking. We do not sell data.

## Why
- to run the service: sign-in, sync between devices, offline work, partner access;
- to send SMS to your customers when you turn it on;
- to take payments for plans and SMS balance;
- to find and fix errors and keep accounts secure.

Legal bases under the GDPR: performance of our contract with you, legitimate interest (security and bug fixing) and legal obligation (accounting for payments).

## Who receives data
Only service providers the product cannot work without, and only what they need:
- Supabase — database, sign-in and file storage;
- Vercel — the babun.app website;
- Expo — delivery of app updates;
- Stripe — payments;
- Twilio — SMS delivery (recipient number and message text);
- Sentry — crash reports.

Some providers may process data outside the EU under the EU Standard Contractual Clauses. Partners you invite see only the teams and blocks you give them access to.

## How long we keep it
As long as your account exists. When you delete your account, the data is erased (details at babun.app/delete-account). Database backups are overwritten within 7 days. Stripe keeps payment records for as long as the law requires.

## Your rights
You can request access to your data, correct it, export it (Office → Data export), delete your account (Office → Sign-in and security → Delete account), object to processing, and complain to a supervisory authority — in Cyprus, the Commissioner for Personal Data Protection (dataprotection.gov.cy). Customers of our users should contact the business that keeps their record in Babun; we will help that business respond.

## Security
Connections are encrypted, each account's teams are isolated from every other account, and partner access is set per block. No system is perfectly secure, but we will notify you and the authority of a serious breach as the law requires.

## Children
Babun is a work tool and is not intended for children under 16.

## Changes
We will announce material changes in the app or by email. The date at the top is the date of the last change.

## Contact
{NAME}, {ADDRESS}, {EMAIL}`;

const TERMS_RU = /* i18n-ignore */ `# Условия использования
Обновлено 4 октября 2026

Эти условия — договор между вами и {NAME} ({ADDRESS}) об использовании Babun: приложения для iPhone и Android и сайта babun.app. Регистрируясь, вы с ними соглашаетесь.

## Аккаунт
Вам должно быть не меньше 18 лет, и вы используете Babun для работы. Вы отвечаете за пароль и за то, что делают партнёры, которым вы дали доступ. Один аккаунт — один человек; партнёры входят своими аккаунтами.

## Тарифы и оплата
Без тарифа доступны личный календарь и события. Тарифы «Соло», «Про» и «Макс» открывают работу с клиентами, командами и партнёрами; у нового аккаунта есть пробный период 14 дней. Тариф и баланс SMS оплачиваются на сайте babun.app через Stripe: подписка продлевается каждый месяц, пока вы её не отмените. Отмена действует с конца оплаченного периода, деньги за уже начатый период не возвращаются, если закон не требует иного. Цены могут меняться — о новой цене мы предупредим заранее.

## SMS
Баланс SMS расходуется на отправленные части сообщений по цене, указанной на сайте. Вы отправляете SMS только тем, кто согласен их получать, и отвечаете за их текст. Деньги на балансе — не вклад и не возвращаются, если закон не требует иного.

## Ваши данные
Всё, что вы ведёте в Babun, принадлежит вам. Вы даёте нам право хранить и обрабатывать эти данные только чтобы сервис работал — как описано в Политике конфиденциальности (babun.app/privacy). Вы отвечаете за то, что у вас есть основания хранить данные своих клиентов.

## Что нельзя
Нарушать закон, рассылать спам, загружать чужие данные без основания, мешать работе сервиса, обходить ограничения тарифа или доступа, перепродавать сервис без нашего согласия.

## Работа сервиса
Мы стараемся, чтобы Babun работал всегда, но перерывы, ошибки и потеря связи возможны. Сервис предоставляется «как есть». Мы не отвечаем за упущенную выгоду и косвенные убытки; наша ответственность ограничена суммой, которую вы заплатили нам за последние 12 месяцев, — кроме случаев, где закон не позволяет её ограничить.

## Прекращение
Вы можете удалить аккаунт в любой момент: Кабинет → Вход и безопасность → Удалить аккаунт. Мы можем приостановить или закрыть аккаунт, который нарушает эти условия, — по возможности предупредив заранее.

## Изменения условий
О существенных изменениях мы сообщим в приложении или по почте не позже чем за 14 дней. Продолжая пользоваться Babun, вы принимаете новые условия.

## Право и споры
Действует право Республики Кипр. Если вы потребитель, за вами остаются права, которые даёт закон вашей страны.

## Связь
{NAME}, {ADDRESS}, {EMAIL}`;

const TERMS_EN = `# Terms of Use
Last updated: October 4, 2026

These terms are an agreement between you and {NAME} ({ADDRESS}) about using Babun: the iPhone and Android apps and the babun.app website. By signing up you accept them.

## Account
You must be at least 18 and use Babun for work. You are responsible for your password and for what the partners you invite do. One account is one person; partners sign in with their own accounts.

## Plans and payment
Without a plan you get a personal calendar and events. The Solo, Pro and Max plans unlock clients, teams and partners; new accounts get a 14-day trial. Plans and SMS balance are paid on babun.app through Stripe: a subscription renews every month until you cancel it. Cancellation takes effect at the end of the paid period; we do not refund a period that has already started unless the law requires it. Prices may change — we will tell you about a new price in advance.

## SMS
SMS balance is spent on the message parts you send, at the price shown on the website. You send SMS only to people who agree to receive them, and you are responsible for their content. Balance is not a deposit and is not refundable unless the law requires it.

## Your data
Everything you keep in Babun belongs to you. You allow us to store and process it only to run the service, as described in the Privacy Policy (babun.app/privacy). You are responsible for having a lawful basis to keep your customers' data.

## Not allowed
Breaking the law, sending spam, uploading other people's data without a lawful basis, disrupting the service, circumventing plan or access limits, reselling the service without our consent.

## Availability
We work to keep Babun running, but interruptions, errors and loss of connection can happen. The service is provided "as is". We are not liable for lost profits or indirect losses; our liability is limited to the amount you paid us in the last 12 months, except where the law does not allow such a limit.

## Termination
You can delete your account at any time: Office → Sign-in and security → Delete account. We may suspend or close an account that breaks these terms, with notice where possible.

## Changes
We will announce material changes in the app or by email at least 14 days in advance. By continuing to use Babun you accept the new terms.

## Law
These terms are governed by the laws of the Republic of Cyprus. If you are a consumer, you keep the rights the law of your country gives you.

## Contact
{NAME}, {ADDRESS}, {EMAIL}`;

const DELETE_RU = /* i18n-ignore */ `# Удаление аккаунта Babun
Обновлено 4 октября 2026

## В приложении
1. Откройте Кабинет → Вход и безопасность.
2. Внизу нажмите «Удалить аккаунт» и подтвердите.

То же самое — на сайте babun.app после входа. Вы выйдете на всех устройствах сразу.

## Если войти не получается
Напишите на {EMAIL} с той почты, на которую зарегистрирован аккаунт, — удалим в течение 30 дней и ответим, когда готово.

## Что удаляется
- ваш аккаунт и вход;
- аккаунт, где вы единственный владелец, вместе со всеми его командами, календарями, записями, клиентами, объектами, файлами, фото, финансами, инвойсами, шаблонами и балансом SMS;
- действующая подписка — она отменяется, и списаний больше не будет.

## Что остаётся
- аккаунты других владельцев, где вы были партнёром: ваш доступ к ним закрывается, а их данные остаются у них;
- записи о прошлых платежах в Stripe — столько, сколько требует закон о бухгалтерском учёте;
- резервные копии базы — до 7 дней, после чего перезаписываются.

Удаление нельзя отменить. Если данные нужны, сначала выгрузите их: Кабинет → Выгрузка данных.`;

const DELETE_EN = `# Delete your Babun account
Last updated: October 4, 2026

## In the app
1. Open Office → Sign-in and security.
2. At the bottom, tap "Delete account" and confirm.

The same works on babun.app after signing in. You are signed out on all devices at once.

## If you cannot sign in
Email {EMAIL} from the address the account is registered with. We delete it within 30 days and reply when it is done.

## What is deleted
- your account and sign-in;
- every account where you are the only owner, with all its teams, calendars, appointments, clients, sites, files, photos, finances, invoices, templates and SMS balance;
- your active subscription — it is cancelled and no further charges are made.

## What is kept
- accounts of other owners where you were a partner: your access is removed, their data stays with them;
- records of past payments at Stripe, as long as accounting law requires;
- database backups — up to 7 days, after which they are overwritten.

Deletion cannot be undone. If you need your data, export it first: Office → Data export.`;

export const LEGAL_TEXTS: Readonly<Record<LegalDocId, Readonly<Record<LegalLang, string>>>> = {
  privacy: { ru: PRIVACY_RU, en: PRIVACY_EN },
  terms: { ru: TERMS_RU, en: TERMS_EN },
  "delete-account": { ru: DELETE_RU, en: DELETE_EN },
};

/** Короткое имя для шапки: полное название на телефоне не помещается. */
export const LEGAL_SHORT: Readonly<Record<LegalDocId, Readonly<Record<LegalLang, string>>>> = {
  privacy: { ru: /* i18n-ignore */ "Конфиденциальность", en: "Privacy" },
  terms: { ru: /* i18n-ignore */ "Условия", en: "Terms" },
  "delete-account": { ru: /* i18n-ignore */ "Удаление аккаунта", en: "Delete account" },
};

export type LegalBlock =
  | { kind: "title"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "item"; text: string };

export interface LegalFill {
  name: string;
  address: string;
  email: string;
}

/** Подставить реквизиты; пустое поле — «—», а не пустота посреди фразы. */
export function fillLegal(text: string, fill: LegalFill): string {
  const value = (v: string) => v.trim() || "—";
  return text
    .replaceAll("{NAME}", value(fill.name))
    .replaceAll("{ADDRESS}", value(fill.address))
    .replaceAll("{EMAIL}", value(fill.email));
}

/** Разметка документа → блоки для экрана. Нумерованный пункт («1. ») — тоже
 *  пункт списка, номер остаётся в тексте. */
export function parseLegal(text: string): LegalBlock[] {
  const blocks: LegalBlock[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("## ")) blocks.push({ kind: "heading", text: line.slice(3) });
    else if (line.startsWith("# ")) blocks.push({ kind: "title", text: line.slice(2) });
    else if (line.startsWith("- ")) blocks.push({ kind: "item", text: line.slice(2) });
    else if (/^\d+\.\s/.test(line)) blocks.push({ kind: "item", text: line });
    else blocks.push({ kind: "paragraph", text: line });
  }
  return blocks;
}

/** Язык документа: явный `?lang=`, иначе язык интерфейса — русский для
 *  русского, английский для всех остальных. */
export function legalLang(param: unknown, uiLocale: string): LegalLang {
  if (param === "ru" || param === "en") return param;
  return uiLocale === "ru" ? "ru" : "en";
}
