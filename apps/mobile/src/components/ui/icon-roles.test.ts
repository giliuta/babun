import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { ICON } from "./tokens";

// СТОРОЖ РОЛЕЙ ЗНАЧКОВ (№53). У одной роли — один размер: шеврон строки,
// команда в шапке шторки и блока, кнопка шапки страницы. Размер берётся
// ИМЕНЕМ роли (`ICON.chevron`), а не числом и не ступенью: ступень `ICON.sm`
// ничего не говорит о смысле, и следующая правка снова подберёт «на глаз».

const here = dirname(fileURLToPath(import.meta.url));
const mobile = resolve(here, "../../..");

function tsxFiles(root: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(root, { withFileTypes: true })) {
    const p = join(root, e.name);
    if (e.isDirectory()) out.push(...tsxFiles(p));
    else if (e.name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

const ALL = [...tsxFiles(join(mobile, "src")), ...tsxFiles(join(mobile, "app"))];

/** Размеры всех JSX-элементов `<Name …>` в файле: `{ where, size }`. */
function sizesOf(file: string, name: string): { where: string; size: string }[] {
  const src = readFileSync(file, "utf8");
  const re = new RegExp(`<${name}\\s([^>]*?)/?>`, "gs");
  const out: { where: string; size: string }[] = [];
  for (const m of src.matchAll(re)) {
    const line = src.slice(0, m.index).split("\n").length;
    const size = /size=\{([^}]+)\}/.exec(m[1] ?? "")?.[1]?.trim() ?? "(нет)";
    out.push({ where: `${relative(mobile, file)}:${line}`, size });
  }
  return out;
}

function offenders(files: string[], name: string, allowed: string[]): string[] {
  return files
    .flatMap((f) => sizesOf(f, name))
    .filter((s) => !allowed.includes(s.size))
    .map((s) => `${s.where} → ${s.size}`);
}

const ui = (p: string) => join(mobile, "src/components/ui", p);

describe("ICON — роли значков", () => {
  test("числа ролей — из шкалы и из канона BLOCKS §0.2", () => {
    const scale = [ICON.lg, ICON.md, ICON.sm, ICON.xs];
    for (const role of ["chevron", "command", "header", "check"] as const) {
      assert.ok(scale.includes(ICON[role]), `ICON.${role}=${ICON[role]} — вне шкалы 24/22/18/14`);
    }
    assert.equal(ICON.chevron, 18, "BLOCKS: «шеврон 18»");
    assert.equal(ICON.command, 18, "BLOCKS: «команды блока 18»");
    assert.equal(ICON.check, 18, "BLOCKS: «справа галка 18»");
    assert.equal(ICON.header, 22);
  });

  test("шеврон строк-дверей в примитивах — ICON.chevron", () => {
    const rows = [
      "SettingsRow.tsx",
      "ValueRow.tsx",
      "ChooseRow.tsx",
      "AddRow.tsx",
      "picker-fields.tsx",
      "card-rows/NavRow.tsx",
    ].map(ui);
    for (const f of rows) {
      assert.ok(sizesOf(f, "ChevronRight").length > 0, `${f}: шеврон не найден — сторож ослеп`);
    }
    assert.deepEqual(offenders(rows, "ChevronRight", ["ICON.chevron"]), []);
  });

  test("Settings2 (настройки списка и блока) везде — ICON.command", () => {
    assert.ok(ALL.some((f) => sizesOf(f, "Settings2").length > 0));
    assert.deepEqual(offenders(ALL, "Settings2", ["ICON.command"]), []);
  });

  test("шестерёнка корня вкладки — ICON.header", () => {
    assert.ok(ALL.some((f) => sizesOf(f, "Settings").length > 0));
    assert.deepEqual(offenders(ALL, "Settings", ["ICON.header"]), []);
  });

  test("«⋯» — кнопка шапки или команда строки, без своих чисел", () => {
    assert.deepEqual(offenders(ALL, "MoreHorizontal", ["ICON.header", "ICON.command"]), []);
    const chrome = [
      "src/features/invoices/detail/InvoiceDetailChrome.tsx",
      "src/features/documents/ReceiptPage.tsx",
      "src/features/clients/ClientDetailChrome.tsx",
      "src/features/appointments/book-form/BookHeader.tsx",
    ].map((p) => join(mobile, p));
    assert.deepEqual(offenders(chrome, "MoreHorizontal", ["ICON.header"]), []);
    assert.deepEqual(offenders(chrome.slice(0, 2), "Share2", ["ICON.header"]), []);
  });

  test("«Назад» в шапке — ICON.header", () => {
    const backs = [
      ui("ScreenHeader.tsx"),
      join(mobile, "src/features/appointments/book-form/BookHeader.tsx"),
    ];
    assert.deepEqual(offenders(backs, "ChevronLeft", ["ICON.header"]), []);
  });

  test("команды шапки шторки и галка выбора — по ролям", () => {
    assert.deepEqual(offenders([ui("TemplatePicker.tsx")], "CopyPlus", ["ICON.command"]), []);
    assert.deepEqual(offenders([ui("card-rows/ChoiceRow.tsx")], "Settings2", ["ICON.command"]), []);
    assert.deepEqual(offenders([ui("select-rows.tsx")], "Check", ["ICON.check"]), []);
  });

  test("команда в шапке блока (SectionCard) — та же ICON.command, что в шапке шторки", () => {
    // Значок приходит пропом (`item.icon`), поэтому общий поиск по имени
    // глифа его не видит: `Settings2` блока типов события рисовался 20, а тот
    // же `Settings2` в шапке `PickerSheet` — 18.
    assert.deepEqual(offenders([ui("SectionCard.tsx")], "item.icon", ["ICON.command"]), []);
    assert.ok(sizesOf(ui("SectionCard.tsx"), "item.icon").length > 0, "SectionCard: команда не найдена — сторож ослеп");
  });
});
