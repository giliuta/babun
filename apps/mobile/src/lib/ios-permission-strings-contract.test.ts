import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// ТЕКСТЫ РАЗРЕШЕНИЙ iOS (выпуск в App Store, 06.10). Ревьюер Apple читает
// окно «Babun запрашивает доступ к камере» на английском — базовые строки
// Info.plist обязаны быть английскими, а переводы лежат в
// `locales/<язык>.json` (Expo кладёт их в <язык>.lproj/InfoPlist.strings).
// Ключ камеры один на приложение: его пишут expo-image-picker и сканер, и
// текст у них обязан совпадать.

const here = dirname(fileURLToPath(import.meta.url));
const mobileRoot = resolve(here, "../..");

type PluginEntry = string | [string, Record<string, unknown>?];
type ExpoConfig = {
  plugins?: PluginEntry[];
  locales?: Record<string, string>;
  ios?: { infoPlist?: Record<string, unknown> };
};

const appJson = JSON.parse(readFileSync(resolve(mobileRoot, "app.json"), "utf8")) as {
  expo: ExpoConfig;
};

const PURPOSE_KEYS = [
  "NSCameraUsageDescription",
  "NSPhotoLibraryUsageDescription",
  "NSContactsUsageDescription",
] as const;
const LANGUAGES = ["en", "ru", "uk", "bg", "el", "de", "es"] as const;

function pluginProps(plugins: PluginEntry[] | undefined, name: string): Record<string, unknown> {
  const entry = (plugins ?? []).find((plugin) => Array.isArray(plugin) && plugin[0] === name);
  assert.ok(Array.isArray(entry) && entry[1], `плагин ${name} с настройками`);
  return entry[1] as Record<string, unknown>;
}

function baseStrings(): Record<(typeof PURPOSE_KEYS)[number], unknown> {
  const picker = pluginProps(appJson.expo.plugins, "expo-image-picker");
  const contacts = pluginProps(appJson.expo.plugins, "expo-contacts");
  return {
    NSCameraUsageDescription: picker.cameraPermission,
    NSPhotoLibraryUsageDescription: picker.photosPermission,
    NSContactsUsageDescription: contacts.contactsPermission,
  };
}

function readLocale(lang: string): Record<string, unknown> {
  const file = resolve(mobileRoot, "locales", `${lang}.json`);
  assert.ok(existsSync(file), `нет locales/${lang}.json`);
  const parsed = JSON.parse(readFileSync(file, "utf8")) as { ios?: Record<string, unknown> };
  assert.ok(parsed.ios, `locales/${lang}.json: нет раздела ios`);
  return parsed.ios;
}

describe("тексты разрешений iOS", () => {
  test("базовые строки Info.plist — английские", () => {
    for (const [key, value] of Object.entries(baseStrings())) {
      assert.equal(typeof value, "string", key);
      const text = value as string;
      assert.match(text, /^Babun /, key);
      assert.doesNotMatch(text, /[\u0370-\u03ff\u0400-\u04ff]/, `${key}: не английский текст`);
    }
    // Микрофона в сборке нет — поэтому камера снимает только фото
    // (`use-file-pickers.ts`).
    assert.equal(pluginProps(appJson.expo.plugins, "expo-image-picker").microphonePermission, false);
  });

  test("камера и сканер пишут один и тот же текст", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- app.config.js — CommonJS
    const makeConfig = require(resolve(mobileRoot, "app.config.js")) as (input: {
      config: ExpoConfig;
    }) => ExpoConfig;
    const config = makeConfig({ config: structuredClone(appJson.expo) });
    const scanner = pluginProps(config.plugins, "react-native-document-scanner-plugin");
    assert.equal(scanner.cameraPermission, baseStrings().NSCameraUsageDescription);
    // Строкой в app.config.js текст камеры больше не живёт.
    const source = readFileSync(resolve(mobileRoot, "app.config.js"), "utf8");
    assert.doesNotMatch(source, /cameraPermission:\s*["'`]/);
    // Прямой ключ в ios.infoPlist перебил бы плагины — его нет.
    for (const key of PURPOSE_KEYS) {
      assert.equal(appJson.expo.ios?.infoPlist?.[key], undefined, key);
    }
  });

  test("переводы: каждый язык — свой файл с тремя ключами", () => {
    assert.deepEqual(
      Object.keys(appJson.expo.locales ?? {}).sort(),
      [...LANGUAGES].sort(),
    );
    const english = baseStrings();
    for (const lang of LANGUAGES) {
      assert.equal(appJson.expo.locales?.[lang], `./locales/${lang}.json`, lang);
      const strings = readLocale(lang);
      assert.deepEqual(Object.keys(strings).sort(), [...PURPOSE_KEYS].sort(), lang);
      for (const key of PURPOSE_KEYS) {
        const value = strings[key];
        assert.equal(typeof value, "string", `${lang}.${key}`);
        const text = value as string;
        assert.ok(text.includes("Babun"), `${lang}.${key}`);
        // Expo пишет InfoPlist.strings как `KEY = "значение";` без
        // экранирования: прямая кавычка или обратная косая сломают файл.
        assert.doesNotMatch(text, /["\\]/, `${lang}.${key}`);
        if (lang === "en") assert.equal(text, english[key], `en.${key} = базовая строка`);
        else assert.notEqual(text, english[key], `${lang}.${key} не переведён`);
      }
    }
    assert.match(readLocale("ru").NSCameraUsageDescription as string, /[\u0400-\u04ff]/);
  });
});
