---
name: babun-sim
user-invocable: true
description: Запуск и верификация мобильного приложения Babun на симуляторе iPhone — перезапуск, скриншоты, навигация, проверка изменений после правок кода. Использовать всякий раз, когда нужно увидеть/проверить изменение в живом приложении.
---

# Babun на симуляторе iPhone

Приложение: `apps/mobile` от корня репозитория (Expo + RN, dev-build). Абсолютный
путь здесь не записан намеренно: репозиторий уже переезжал, и захардкоженный
путь пережил переезд молча — команды ниже пиши от корня, а корень бери из
рабочего каталога сессии (`git rev-parse --show-toplevel`).

**Bundle ID и схема зависят от варианта сборки** (`apps/mobile/app.config.js`):

| Вариант | Как собран | Bundle ID | Deep-link |
|---|---|---|---|
| Dev-клиент | `bun run ios` (= `ios:dev`, `APP_VARIANT=development`) | `com.babun.crm.dev` | `babundev://` |
| Боевой | сборка без `APP_VARIANT` / TestFlight | `com.babun.crm` | `babun://` |

Обе иконки живут на симуляторе рядом — это сделано намеренно, чтобы TestFlight не
перезаписывал стройку. Поэтому НЕ подставляй id вслепую: сперва посмотри, что
установлено, и работай именно с тем приложением, которое смотришь:

```bash
xcrun simctl listapps booted | grep -i 'com.babun'
```

Metro обычно уже запущен на :8081 (проверить: `lsof -iTCP:8081 -sTCP:LISTEN`).
`node` на машине ЕСТЬ (v26 в `/opt/homebrew/bin`), но пакетный менеджер и раннер
тестов в проекте — `bun`: команды пиши через `bun` / `bunx` (или `python3` для
разовых скриптов), иначе разъедется lockfile.

## Быстрая верификация изменения (основной цикл)

Fast Refresh подхватывает правки сам. После сохранения файла подожди 2-3 с и сними скриншот:

```bash
xcrun simctl io booted screenshot /tmp/babun-shot.png && sips -Z 900 /tmp/babun-shot.png
```

Затем Read скриншот. НЕ проси пользователя проверить руками — смотри сам.

## Перезапуск приложения (если Fast Refresh не помог / ошибка на экране)

```bash
APP=com.babun.crm.dev   # ← или com.babun.crm, см. таблицу выше
xcrun simctl terminate booted "$APP"; sleep 2
xcrun simctl launch booted "$APP" && sleep 12   # холодный старт ~10 с
```

## Навигация по приложению

- Тапы: `xcrun simctl` не умеет тапать. Для навигации используй deep links:
  `xcrun simctl openurl booted "babundev://<путь>"` для dev-клиента
  (`babun://` — только для боевой сборки; чужая схема молча не откроет ничего).
  Пути = маршруты expo-router, то есть файлы в `apps/mobile/app/`.
- Если нужен именно жест (свайп, длинное нажатие, ввод текста) — это умеет
  MCP симулятора (`mcp__Claude_Code_iOS_Simulator__control`: tap/swipe/text).
- Либо попроси пользователя тапнуть, но сперва исчерпай deep links.

## Если Metro не запущен

```bash
cd "$(git rev-parse --show-toplevel)/apps/mobile" && bunx expo start --dev-client
```
(в фоне, `run_in_background: true`). Первый нативный билд: `bunx expo run:ios` — только если dev-build отсутствует на симуляторе.

## Диагностика

- Ошибка «Network request failed» после сна Mac — транзиентная, лечится перезапуском приложения.
- Supabase жив? `curl -s -o /dev/null -w "%{http_code}" https://rdtokosbqvgemicqeqwz.supabase.co/auth/v1/health` → 401 = жив.
- Логи приложения: `xcrun simctl spawn booted log stream --predicate 'processImagePath contains[c] "babun"' --style compact` (в фоне, с таймаутом).
  Именно `contains[c]`: исполняемый файл называется `Babun` с большой буквы, а
  голый `contains` в NSPredicate регистрозависим и молча даёт пустой поток.
- Две загруженные машины? `xcrun simctl list devices booted` покажет обе; тогда
  вместо `booted` подставляй UDID нужной, иначе команда уйдёт не туда.
- Тему симулятора НЕ переключай: приложение light-only по закону
  (`apps/mobile/src/theme/colors.ts`), тёмной палитры нет — тёмный скриншот
  ничего не проверит, а покажет системную рамку поверх светлого экрана.
