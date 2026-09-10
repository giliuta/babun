import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
/** apps/mobile — от него отсчитываются пути в каталоге. */
const APP = resolve(here, "../..");
/** Корень репозитория — там лежит AGENTS.md. */
const ROOT = resolve(APP, "../..");

const catalog = readFileSync(resolve(APP, "docs/BLOCKS.md"), "utf8");

// БИБЛИОТЕКА БЛОКОВ НЕ ИМЕЕТ ПРАВА ВРАТЬ (владелец 2026-09-10: «потом я
// говорю — посмотри в файле, как сделано, и он сразу видит: вот так надо
// было»). Документ, на который так смотрят, обязан указывать на живой код:
// на этом проекте дважды «исправляли» верно работающий код обратно к
// устаревшему абзацу — раздел про объекты клиента описывал удалённые
// страницы, и именно он позволил форме объекта разойтись на две.
//
// Тест не проверяет прозу. Он проверяет ровно то, что делает файл полезным:
// каждый названный путь существует, каждый названный компонент существует,
// каждый образец разметки всё ещё стоит там, куда файл посылает.

describe("библиотека блоков указывает на живой код", () => {
  test("каждый путь из каталога существует", () => {
    const paths = new Set(
      [...catalog.matchAll(/`([\w./()[\]-]+\.(?:tsx|ts|md))(?::\d+)?`/g)].map(
        (m) => m[1],
      ),
    );
    assert.ok(paths.size > 20, `нашёл всего ${paths.size} путей — разбор сломался`);
    // Двери маршрутов каталог называет коротко («clients/object-types.tsx»):
    // так их называет и владелец. Резолвим по тем же префиксам, по которым
    // живут маршруты.
    const roots = [APP, ROOT, resolve(APP, "app"), resolve(APP, "app/(dashboard)"), resolve(APP, "app/(dashboard)/(home)")];
    for (const path of paths) {
      const found = roots.some((root) => existsSync(resolve(root, path)));
      assert.ok(found, `BLOCKS.md ссылается на несуществующий файл: ${path}`);
    }
  });

  test("каждый компонент из списка «уже компоненты» экспортируется", () => {
    const tail = catalog.slice(catalog.indexOf("Уже компоненты и копируются"));
    const names = [...tail.matchAll(/`([A-Z][A-Za-z]+)`/g)].map((m) => m[1]);
    assert.ok(names.length > 10, `нашёл ${names.length} имён — разбор сломался`);
    const sources = [
      "src/features/clients/ObjectFields.tsx",
      "src/features/clients/ClientPickerSheet.tsx",
      "src/features/clients/ObjectPickerSheet.tsx",
      "src/features/reference/LabelPickerSheet.tsx",
      "src/features/clients/TagPickerSheet.tsx",
      "src/features/appointments/BookingPickers.tsx",
      "src/features/appointments/EventTypeBlock.tsx",
      "src/features/appointments/PaymentBlock.tsx",
      "src/features/appointments/AppointmentFilesBlock.tsx",
      "src/features/appointments/InlineNoteField.tsx",
      "src/features/appointments/BookingSummary.tsx",
      "src/features/clients/blocks/ObjectsBlock.tsx",
      "src/components/ui/select-rows.tsx",
    ]
      .map((p) => readFileSync(resolve(APP, p), "utf8"))
      .join("\n");
    for (const name of names) {
      assert.match(
        sources,
        new RegExp(`export function ${name}\\(`),
        `BLOCKS.md обещает компонент ${name}, а его нет`,
      );
    }
  });

  test("образцы разметки всё ещё стоят там, куда посылает каталог", () => {
    const book = readFileSync(resolve(APP, "app/book/index.tsx"), "utf8");
    // Блоки записи, которые каталог показывает разметкой (пока они не вынесены
    // в компоненты). Исчезла подпись — каталог посылает в пустоту.
    for (const marker of [
      'SectionCard title="Клиент"',
      'SectionCard title="Объект"',
      'SectionCard title="Услуги"',
      'SectionCard title="Заметка"',
      "<TeamLabelRow",
      "<WhenRow",
      "<TotalRow",
      "<EventTypeBlock",
      "<AppointmentFilesBlock",
      "<ClientPickerSheet",
      "<ServicePicker",
    ]) {
      assert.ok(
        book.includes(marker),
        `в app/book/index.tsx больше нет «${marker}» — поправь BLOCKS.md`,
      );
    }
  });

  test("каталог назван в правилах, иначе его никто не откроет", () => {
    const agents = readFileSync(resolve(ROOT, "AGENTS.md"), "utf8");
    assert.match(agents, /BLOCKS\.md/);
  });
});
