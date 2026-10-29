import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

// ТРИ ШЕСТЕРЁНКИ — ОДИН СТИЛЬ. Настройки календаря, клиентов и финансов
// собраны одним примитивом: группа — `SettingsGroup` с подписью ВНУТРИ белой
// карточки (тот же рецепт, что `SectionCard title` у блоков записи и
// клиента), швы между строками рисует она же. Своих карточек, подписей над
// карточкой и ручных разделителей у страниц шестерёнок нет — так они и
// разошлись в три разных вида.

const src = (path: string) => readFileSync(join(__dirname, "..", "..", path), "utf8");

const PAGES = [
  "app/(dashboard)/finances/settings.tsx",
  "src/features/clients/settings-page/ClientsSettingsScreen.tsx",
  "src/features/clients/settings-page/SettingsBody.tsx",
  "src/features/clients/caller-id/CallerIdSettingsGroup.tsx",
  "src/features/calendar/settings-screen/CalendarSettingsScreen.tsx",
  "src/features/calendar/settings-screen/CalendarTeamRows.tsx",
  "src/features/calendar/settings-screen/CalendarReferenceRows.tsx",
  "src/features/calendar/settings-screen/CalendarExitRows.tsx",
  "src/features/calendar/settings-screen/CalendarIdentityCard.tsx",
];

describe("шестерёнки календаря, клиентов и финансов", () => {
  test("группа — SettingsGroup с подписью внутри карточки", () => {
    const group = src("src/components/ui/SettingsGroup.tsx");
    assert.doesNotMatch(group, /SectionEyebrow/, "подпись группы — над карточкой");
    assert.match(group, /<SectionCard title=\{title\}/, "подпись группы — не рецептом SectionCard title");
    assert.match(group, /title: string;/, "подпись группы необязательна");
  });

  test("страницы не собирают группы руками", () => {
    for (const file of PAGES) {
      const source = src(file);
      assert.doesNotMatch(source, /SectionEyebrow/, `${file}: подпись над карточкой`);
      assert.doesNotMatch(source, /<SectionCard\b/, `${file}: своя карточка вместо SettingsGroup`);
      assert.doesNotMatch(source, /<Divider\b/, `${file}: разделитель руками`);
      for (const m of source.matchAll(/<SettingsGroup\b([\s\S]*?)>/g)) {
        assert.match(m[1], /\btitle=/, `${file}: группа без подписи`);
      }
    }
  });

  test("шапки — «Настройки …» у всех трёх", () => {
    assert.match(src("app/(dashboard)/finances/settings.tsx"), /title="Настройки финансов"/);
    assert.match(src("src/features/clients/settings-page/ClientsSettingsScreen.tsx"), /title="Настройки клиентов"/);
    const calendar = src("src/features/calendar/settings-screen/CalendarSettingsScreen.tsx");
    assert.match(calendar, /title="Настройки календаря"/);
    assert.doesNotMatch(calendar, /title="Календарь"/);
  });

  test("календарь заводят словом «Создать», а не «Добавить» (словарь кнопок «Создать N»)", () => {
    const bar = src("src/features/calendar/settings-screen/CalendarChipsBar.tsx");
    assert.match(bar, />\s*Создать\s*</);
    assert.match(bar, /accessibilityLabel="Создать календарь"/);
    assert.doesNotMatch(bar, />\s*Добавить\s*<|"Добавить календарь"/);
    const account = src("src/features/finances/account-editor/CreateAccountSheet.tsx");
    assert.doesNotMatch(account, /"Добавить команду"/);
    assert.match(account, /label="Создать календарь"/);
  });
});
