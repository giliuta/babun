# Выпуск в TestFlight

> Статус на 2026-08-26. Apple Developer Program у владельца **есть**,
> приложение в App Store Connect **заведено**, в TestFlight уже лежит
> сборка, и на телефоне владельца стоят обе иконки — боевая
> `com.babun.crm` из TestFlight и `com.babun.crm.dev` через Metro.
> Чего нет: связи этого репозитория с EAS. Прошлая сборка уехала мимо
> текущего дерева — следов в конфиге не осталось.

## Что уже готово в репозитории

| Что | Состояние |
|---|---|
| `eas-cli` | 22.4.0, поставлен глобально (`bun add -g eas-cli`) |
| `eas.json` | профили `development` / `simulator` / `preview` / `production` |
| Bundle ID релиза | `com.babun.crm` — совпадает с тем, что в App Store Connect |
| Bundle ID dev-клиента | `com.babun.crm.dev` — отдельный, чтобы TestFlight не затирал стройку |
| Apple Team ID | `LW4NJRQ462` в `eas.json` |
| Шифрование | `ITSAppUsesNonExemptEncryption: false` — экспортная анкета не задаётся |
| Разрешения | камера, фото, контакты — тексты на русском в `app.json` |
| Нумерация сборок | `appVersionSource: "remote"` + `autoIncrement` — номер живёт на серверах EAS |
| Автоматика | `.github/workflows/ios-testflight.yml` — сборка + отправка одной кнопкой |
| Релизная конфигурация | компилируется: `bun run ios:prod:verify` → BUILD SUCCEEDED |
| `ios/` | генерируется `expo prebuild`, в git не лежит и лежать не должен |

## Что требуется от владельца — один раз

**1. Аккаунт Expo и привязка проекта.** Без `projectId` сборка не стартует.

```bash
eas login
```

```bash
cd /Users/artem/Documents/Babun/apps/mobile && eas init
```

Если прошлая TestFlight-сборка делалась через EAS, проект в аккаунте уже
есть — тогда привязываться надо к нему, а не создавать второй.
Проверяется командой `eas project:info`.

**2. Узнать номер последней сборки в TestFlight.** EAS ведёт нумерацию у
себя и начнёт с единицы, а Apple отклоняет сборку с номером не больше уже
загруженного. Смотреть в App Store Connect → вкладка TestFlight, колонка
Build. Число сообщить — оно выставляется в EAS один раз.

**3. Ключ App Store Connect API** — то, что делает отправку по-настоящему
автоматической. Без него `eas submit` каждый раз требует живого входа в
Apple, и никакой workflow не поможет.

App Store Connect → **Users and Access → Integrations → App Store Connect
API** → создать ключ с ролью **App Manager** → скачать файл `.p8`
(даётся ровно один раз, второй скачки не будет).

Дальше отдать ключ в EAS:

```bash
cd /Users/artem/Documents/Babun/apps/mobile && eas credentials
```

Платформа iOS → профиль `production` → App Store Connect API Key → указать
скачанный файл. После этого ключ живёт у Expo, и локально его хранить не
нужно.

**4. Токен Expo для GitHub.** expo.dev → Account settings → Access tokens →
создать токен. Положить его в репозиторий: **Settings → Secrets and
variables → Actions → New repository secret**, имя `EXPO_TOKEN`.

## Как выпускать после этого

**Автоматически** — вкладка Actions в GitHub → workflow «iOS → TestFlight»
→ Run workflow. Либо тегом:

```bash
git tag v1.0.1 && git push origin v1.0.1
```

Workflow сначала гоняет `typecheck` и `bun test`, и только на зелёном
собирает и отправляет. Порядок такой намеренно: сборку, уехавшую в
TestFlight, отозвать нельзя — можно только выложить новую поверх.

Запуск **только вручную или по тегу**, не на каждый push: сборка на EAS
платная (на бесплатном тарифе — очередь), а Apple принимает ограниченное
число сборок в сутки.

**Руками, с машины** — то же самое одной командой:

```bash
cd /Users/artem/Documents/Babun/apps/mobile && eas build --platform ios --profile production --auto-submit
```

Сборка идёт 15–40 минут на серверах, терминал можно закрыть. В TestFlight
она появляется ещё через 10–40 минут — Apple обрабатывает её у себя.

## Проверить, не трогая Apple вовсе

```bash
bun run ios:prod:verify
```

`prebuild` под production + `xcodebuild` без подписи. Ловит поломки
нативной части релизной конфигурации, но не проверяет подпись и приём на
стороне Apple — это видно только на настоящем `eas build`.

## Что мешает жить, но не блокирует

`bunx expo-doctor` показывает две вещи, обе старше этой задачи:

1. **Две копии React.** `lucide-react-native` тянет себе `react@19.2.4`
   поверх приколоченного 19.1.0. `overrides` в корневом `package.json`
   снял часть копий, но не эту; дедуп в `metro.config.js` держит бандл
   целым. Для нативной сборки это риск «Invalid hook call» — закрыть
   отдельной задачей до раздачи бригадам.
2. **Патч-дрейф Expo SDK**: `expo` 54.0.36 против ожидаемых 54.0.37, плюс
   `expo-constants` и `expo-file-system`. Лечится
   `bunx expo install --check` — правка зависимостей, отдельным коммитом
   и с прогоном гейтов.
