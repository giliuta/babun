# STORY-103 — пуш на телефон команды при закрытом приложении

Статус: **код готов, на боевую не накачено** (идея №1 из «033 идеи»).

## Что было

Мастер узнавал о новой работе, только открыв приложение:
`TeamActivityNotifier` опрашивал журнал раз в 30 секунд и только при открытом
приложении, только у владельца. `send_push` умеет лишь старый веб-пуш (VAPID).

## Что сделано

| Слой | Где | Что |
|---|---|---|
| База | `supabase/migrations/20261027162300_mobile_push.sql` | `push_devices` (Expo push token, язык телефона; RLS — свои строки, писать только функцией), `register_push_device` / `unregister_push_device`, `push_activity_targets` (кому сказать о строке журнала), триггер `zz_push_activity` на `change_log` → `net.http_post` в функцию, выключатель `app_settings.mobile_push_enabled` (стартует `off`) |
| Сервер | `supabase/functions/push_activity/` | текст на языке телефона (7 языков), отправка в Expo Push пачками по 100, забывает `DeviceNotRegistered` |
| Телефон | `src/lib/push-device.ts`, `features/cabinet/PushRegistrar.tsx` | токен при входе и раз в 6 ч; системный вопрос о разрешении — один раз при входе; канал Android «Babun» с баннером |
| Выход | `lib/auth-clear.ts`, `cabinet/account/DevicesSection.tsx` | телефон уходит из получателей ДО выхода; «Выйти на других устройствах» снимает и их |
| Тап | `features/calendar/reminders.ts`, `app/_layout.tsx` | тот же разбор `calendar-appointment`, что у напоминаний, плюс `tenantId`: запись другого аккаунта человека — сперва переход в него |
| Экран | `cabinet/NotificationsScreen.tsx` | «Что происходит в команде» видит и мастер (без «Оплат») — иначе его выбор нечем задать |
| Опрос | `cabinet/TeamActivityNotifier.tsx` | молчит, когда сервер шлёт пуши (`live`), — без дублей |

### Кому и о чём

- **Кому** — всем, кто видит календарь записи (`access_calendars_of`, блок
  `calendar.records`; владельцу — все календари), о доходе — кто видит доходы
  (`finance.income`). Автору правки — никогда. Имя клиента — только при праве
  `record.client`.
- **Выбор** — `team_notification_prefs` человека в команде; строки нет —
  умолчания столбцов (новые/переносы/отмены — да, оплаты — нет).
- **Тексты:** мастеру «Вам назначена работа» / владельцу «Новая работа» ·
  «Работу перенесли» · «Работу отменили» · «Клиент отменил по ссылке» ·
  «Работу передали другой команде» · «Оплачено 120 €». Тело: «Завтра, 14:00,
  Иван Петров, Лимассол».
- **Молчит:** события, правки без смены времени/места/клиента/календаря
  (услуги, материалы, «выполнено», оплата внутри записи — о деньгах говорит
  сам доход).

## Проверка

- Dry-run миграции на боевой в откатываемой транзакции — 23 сценария зелёные
  (скрипт: `scratchpad/dry/tail.sql` сессии 033·1): регистрация, отказы
  (без входа, битый токен, платформа), RLS, новая/перенос/правка заметки/
  смена календаря/отмена по ссылке/доход по выбору/событие/телефон перешёл к
  другому/выключатель. После — на боевой ни таблицы, ни функций.
- `bun test supabase/functions/push_activity` — текст и сборка сообщений.
- Симулятор iPhone 18 Pro (вход AirFix): `xcrun simctl push` с полезной
  нагрузкой в форме Expo (собрана настоящим `handler.ts`) → баннер при
  свёрнутом и при закрытом приложении; тап из свёрнутого открыл запись
  «Никита, пт 30 октября 12:00, Y&D, Paphos».
- Тестовая отправка через Expo Push на токен симулятора дошла до Expo, ответ
  `InvalidCredentials` — нет ключа APNs (шаг 1 ниже).
- **Холодный старт в дев-клиенте запись не открывает**: стартовый ответ
  уведомления там пуст (`getLastNotificationResponseAsync` → null) — и у пуша,
  и у местного напоминания, путь общий и был до пуша. Проверить на сборке
  TestFlight/App Store; если и там пусто — чинить общий путь в `app/_layout.tsx`.
- Свой дев-клиент Xcode 27.1 падает при запуске без UIScene (память
  xcode27-needs-uiscene); проверка шла на клиенте 04.10 (Xcode 26.5), где уже
  есть `expo-notifications` и `aps-environment`.

## Что ждёт владельца (по порядку)

1. **Ключ APNs в Expo** (iPhone): `cd apps/mobile && eas credentials -p ios` →
   профиль production → *Push Notifications: Manage your Apple Push
   Notifications Key* → *Set up a new key* (EAS сам заведёт ключ в Apple
   Developer по входу Apple ID) или загрузить свой `.p8` (Apple Developer →
   Keys → «+» → Apple Push Notifications service). Ключ один на команду Apple —
   его же назначить и `com.babun.crm.dev`, если нужен пуш в дев-клиент.
2. **FCM для Android:** Firebase → проект → Android-приложение `com.babun.crm` →
   скачать `google-services.json` → положить в `apps/mobile/` (или переменной-
   файлом EAS `GOOGLE_SERVICES_JSON`). Затем ключ сервисного аккаунта FCM v1:
   `eas credentials -p android` → *Google Service Account* → *FCM V1*.
   Android требует **новой нативной сборки** (файл Firebase вшивается в неё).
3. **iPhone новой сборки НЕ требует:** `expo-notifications` с `aps-environment
   = production` в сборке с 25.08 (1.0.3 в App Store её содержит). После шага 1
   хватает OTA с этим кодом.
4. Накат миграции `mobile_push` (apply_migration) и деплой функции:
   `supabase functions deploy push_activity`. Секрет `EXPO_ACCESS_TOKEN` —
   только если в Expo включена «Enhanced security for push».
5. Слияние в `feat/unified-expo-web` → OTA на runtime 1.0.3.
6. **Включить:** `update app_settings set value = 'on' where key = 'mobile_push_enabled';`
   С этого момента телефоны, запустившие новую версию, перестают опрашивать
   журнал сами и получают пуши с сервера.

## Как проверить после включения

- Логи функции: Supabase → Edge Functions → `push_activity` → строки
  `push_activity {"sent":…,"failed":…,"dropped":…}` и `expo ticket error …`.
- Очередь pg_net: `select id, status_code, content from net._http_response order by id desc limit 5;`
- Создать запись в календаре мастера с телефона владельца → у мастера при
  закрытом приложении «Вам назначена работа», тап открывает запись.
