# Выпуск в App Store / TestFlight

> Статус на 2026-08-26: **приложение в TestFlight ни разу не уезжало.**
> Со стороны репозитория всё готово; осталось три шага, которые может
> сделать только владелец — они требуют паролей, а их не вводит никто,
> кроме него.

## Что уже готово

| Что | Состояние |
|---|---|
| `eas-cli` | установлен глобально (`bun add -g eas-cli`), версия 22.4.0 |
| `eas.json` | профили `development` / `simulator` / `preview` / `production` |
| Bundle ID релиза | `com.babun.crm` |
| Bundle ID dev-клиента | `com.babun.crm.dev` — отдельный, чтобы TestFlight-сборка не затирала стройку на телефоне |
| Apple Team ID | `LW4NJRQ462` в `eas.json` |
| Шифрование | `ITSAppUsesNonExemptEncryption: false` — экспортная анкета при загрузке не задаётся |
| Разрешения | камера, фото, контакты — тексты на русском в `app.json` |
| Нумерация сборок | `appVersionSource: "remote"` + `autoIncrement` — номер живёт на серверах EAS, локально его держать не надо |
| `ios/` | генерируется `expo prebuild`, в git не лежит и лежать не должен |

## Три шага владельца

**1. Аккаунт Expo.** Без входа не работает ни `eas build`, ни `eas init`.

```bash
eas login
```

**2. Привязать проект к EAS.** Допишет `extra.eas.projectId` в `app.json` —
без этого поля сборка не стартует.

```bash
cd apps/mobile && eas init
```

**3. Apple Developer Program.** Нужен действующий платный аккаунт ($99/год)
на том же Team ID `LW4NJRQ462`. Приложение в App Store Connect можно не
заводить руками: `eas submit` предложит создать его сам под
`com.babun.crm`.

## Дальше — обычный цикл

```bash
cd apps/mobile
eas build --platform ios --profile production   # сборка на серверах EAS
eas submit --platform ios --latest              # отправка в App Store Connect
```

Первая сборка спросит про сертификат и provisioning profile — отвечать
«let EAS handle it», тогда ключи живут у Expo и их не надо носить между
машинами. После `eas submit` сборка появляется в TestFlight через
10–40 минут (обработка на стороне Apple).

Проверить сборку на симуляторе, не трогая Apple вовсе:

```bash
bun run ios:prod:verify   # prebuild под production + xcodebuild без подписи
```

## Что мешает жить, но не блокирует

`bunx expo-doctor` показывает две вещи, обе старше этой задачи:

1. **Две копии React.** `lucide-react-native` тянет себе `react@19.2.4`
   поверх приколоченного 19.1.0. `overrides` в корневом `package.json`
   снял часть копий, но не эту; дедуп в `metro.config.js` держит бандл
   целым. Для нативной сборки это риск «Invalid hook call» — стоит
   закрыть отдельной задачей, до первой публичной раздачи.
2. **Патч-дрейф Expo SDK**: `expo` 54.0.36 против ожидаемых 54.0.37,
   плюс `expo-constants` и `expo-file-system`. Лечится
   `bunx expo install --check`, но это правка зависимостей — отдельным
   коммитом и с прогоном гейтов.
