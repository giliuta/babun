---
name: babun-sim
user-invocable: true
description: Запуск и верификация мобильного приложения Babun на симуляторе iPhone — перезапуск, скриншоты, навигация, проверка изменений после правок кода. Использовать всякий раз, когда нужно увидеть/проверить изменение в живом приложении.
---

# Babun на симуляторе iPhone

Приложение: `/Users/artem/Documents/babun2/babun-crm/apps/mobile` (Expo + RN, dev-build).
Bundle ID: `com.babun.crm`. Metro обычно уже запущен на :8081 (проверить: `lsof -iTCP:8081 -sTCP:LISTEN`).
На машине НЕТ node в PATH для скриптов — используй `bun` / `bunx` / `python3`.

## Быстрая верификация изменения (основной цикл)

Fast Refresh подхватывает правки сам. После сохранения файла подожди 2-3 с и сними скриншот:

```bash
xcrun simctl io booted screenshot /tmp/babun-shot.png && sips -Z 900 /tmp/babun-shot.png
```

Затем Read скриншот. НЕ проси пользователя проверить руками — смотри сам.

## Перезапуск приложения (если Fast Refresh не помог / ошибка на экране)

```bash
xcrun simctl terminate booted com.babun.crm; sleep 2
xcrun simctl launch booted com.babun.crm && sleep 12   # холодный старт ~10 с
```

## Навигация по приложению

- Тапы: `xcrun simctl` не умеет тапать. Для навигации используй deep links:
  `xcrun simctl openurl booted "babun://<путь>"` (expo-router: пути = маршруты в `app/`).
- Либо попроси пользователя тапнуть, но сперва исчерпай deep links.

## Если Metro не запущен

```bash
cd /Users/artem/Documents/babun2/babun-crm/apps/mobile && bunx expo start --dev-client
```
(в фоне, `run_in_background: true`). Первый нативный билд: `bunx expo run:ios` — только если dev-build отсутствует на симуляторе.

## Диагностика

- Ошибка «Network request failed» после сна Mac — транзиентная, лечится перезапуском приложения.
- Supabase жив? `curl -s -o /dev/null -w "%{http_code}" https://rdtokosbqvgemicqeqwz.supabase.co/auth/v1/health` → 401 = жив.
- Логи приложения: `xcrun simctl spawn booted log stream --predicate 'processImagePath contains "babun"' --style compact` (в фоне, с таймаутом).
- Тёмная тема: `xcrun simctl ui booted appearance dark` / `light`.
