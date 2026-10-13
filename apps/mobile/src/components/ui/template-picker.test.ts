import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { readModuleSource } from "@/lib/module-source";

// ШАБЛОНЫ ИЗ ДРУГИХ КОМАНД — ВО ВСЕХ СПРАВОЧНИКАХ (владелец 11.10: «как с
// услугами — со всеми: категории, метки и так далее»).

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(here, rel), "utf8");

test("отбор шаблонов: другие команды, без заведённых здесь по имени, без повторов", async () => {
  // Модуль тянет react-native — проверяем ту же функцию её текстом не надо:
  // она чистая, но импорт файла поднял бы RN. Поэтому — по исходнику правила.
  const src = read("TemplatePicker.tsx");
  assert.match(src, /if \(!team \|\| team === opts\.teamId\) return false;/);
  assert.match(src, /if \(!name \|\| here\.has\(name\) \|\| seen\.has\(name\)\) return false;/);
});

// Screens split into an entry and a parts folder (rule of 400 lines) are
// read together with the folder: the sheet itself lives there.
const PARTS: Record<string, string> = {
  "../../features/reference/screens/LabelsScreen.tsx": "../../features/reference/screens/labels",
  "../../features/reference/screens/ObjectTypesScreen.tsx": "../../features/reference/screens/object-types",
  "../../../app/(dashboard)/clients/tags.tsx": "../../features/clients/tags-page",
};
const readWithParts = (rel: string) =>
  readModuleSource(resolve(here, rel), PARTS[rel] && resolve(here, PARTS[rel]));

const SHEETS: [string, string][] = [
  ["метки", "../../features/reference/screens/LabelsScreen.tsx"],
  ["типы событий", "../../features/reference/screens/EventTypeSheet.tsx"],
  ["типы объектов", "../../features/reference/screens/ObjectTypesScreen.tsx"],
  ["источники", "../../../app/(dashboard)/clients/sources.tsx"],
  ["теги", "../../../app/(dashboard)/clients/tags.tsx"],
  ["категории", "../../features/finances/CategoryEditorSheet.tsx"],
  ["шаблоны SMS", "../../features/sms/SmsTemplateSheet.tsx"],
  ["услуги", "../../features/services/ServiceSheet.tsx"],
];

for (const [name, path] of SHEETS) {
  test(`${name}: значок шаблонов в шапке шторки, список в той же шторке`, () => {
    const src = readWithParts(path);
    assert.match(src, /<TemplatesHeaderButton picking=\{picking\}/);
    assert.match(src, /\{picking \? \(\s*<TemplateList/);
    assert.doesNotMatch(src, /chooseOption\(/);
  });
}

test("шаблоны — только у владельца аккаунта", () => {
  for (const path of [
    "../../features/reference/screens/LabelsScreen.tsx",
    "../../features/reference/screens/EventTypesScreen.tsx",
    "../../features/reference/screens/ObjectTypesScreen.tsx",
    "../../../app/(dashboard)/clients/sources.tsx",
    "../../../app/(dashboard)/clients/tags.tsx",
    "../../features/finances/CategoryEditorSheet.tsx",
    "../../features/sms/SmsTeamScreen.tsx",
  ]) {
    assert.match(readWithParts(path), /const isOwner = useDataRole\(\)\.data === "owner";/, path);
  }
});
