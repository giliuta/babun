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
      "src/components/ui/ReferenceBlock.tsx",
      "src/features/finances/CategoryBlock.tsx",
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

  // ЧИСЛА ГЕОМЕТРИИ — ГЛАВНОЕ, ЧТО КОПИРУЮТ (владелец 2026-09-10: «мне
  // главное, чтоб была выполнена полностью эта же архитектура: отступ от
  // блоков, отступ от надписи, полностью выбор иконки, всё»). Каталог
  // называет их числами; если код поедет, а каталог останется, копировать по
  // нему станет вредно. Поэтому каждое число проверяется в источнике.
  test("отступы и кегли блока в коде те же, что в каталоге", () => {
    const card = readFileSync(resolve(APP, "src/components/ui/SectionCard.tsx"), "utf8");
    assert.match(card, /dense \? "mt-1\.5" : "mt-2"/, "промежуток между блоками поехал");
    assert.match(card, /marginHorizontal: GUTTER/, "боковое поле блока больше не GUTTER");
    assert.match(card, /relative flex-row items-center px-4/, "команда блока больше не абсолютом относительно шапки");
    assert.match(card, /dense \? "pb-0 pt-1\.5" : "pb-0\.5 pt-2\.5"/, "отступы подписи блока поехали");
    assert.match(card, /fontSize: 11,/, "кегль подписи блока больше не 11");
    assert.match(card, /letterSpacing: 0\.6,/, "трекинг подписи блока поехал");
    // Команда блока стоит АБСОЛЮТОМ — иначе подпись съезжает на 6px у блоков
    // с иконкой, и «по пикселям одинаково» перестаёт быть правдой.
    assert.match(card, /position: "absolute"/, "команда блока вернулась в поток");
    assert.match(card, /right: 16/);
    assert.match(card, /top: 6/);
    assert.match(card, /gap: 16/);
    assert.match(card, /className="p-4 pt-2"/, "внутренние отступы тела блока поехали");

    const tokens = readFileSync(resolve(APP, "src/components/ui/tokens.ts"), "utf8");
    assert.match(tokens, /ICON = \{ lg: 24, md: 22, sm: 18, xs: 14 \}/, "размеры иконок поехали");
    assert.match(tokens, /GUTTER = 16/, "гуттер больше не 16");

    const circle = readFileSync(resolve(APP, "src/components/ui/IconCircle.tsx"), "utf8");
    assert.match(circle, /size = 34/, "кружок двери блока больше не 34pt");

    const choose = readFileSync(resolve(APP, "src/components/ui/ChooseRow.tsx"), "utf8");
    assert.match(choose, /compact \? "py-2" : "py-3\.5"/, "высота двери блока поехала");
    assert.match(choose, /marginLeft: 12,/, "отступ подписи от кружка поехал");
    assert.match(choose, /fontSize: 17,/, "кегль двери блока больше не 17");
    assert.match(choose, /size=\{compact \? 30 : 34\}/, "плотный кружок двери поехал");

    // ВЫБРАННОЕ В БЛОКЕ — те же числа, что у двери: кружок 34 (30 в плотном),
    // 12pt до имени, кегль 17/600. Иначе при выборе блок «прыгает».
    const ref = readFileSync(resolve(APP, "src/components/ui/ReferenceBlock.tsx"), "utf8");
    assert.match(ref, /const size = dense \? 30 : 34;/, "кружок выбранного разошёлся с дверью");
    assert.match(ref, /paddingHorizontal: 16,/, "боковой отступ строки блока поехал");
    assert.match(ref, /gap: 12,/, "отступ имени от кружка поехал");
    assert.match(ref, /minHeight: dense \? 60 : 62,/, "высота строки выбранного поехала");
    assert.match(ref, /fontSize: 17, fontWeight: "600"/, "кегль имени в блоке поехал");
    assert.match(
      ref,
      /\/\^#\[0-9a-f\]\{6\}\$\/i\.test\(tint\)/,
      "пропала защита от rgba-токена: подложка кружка станет чёрной",
    );

    const note = readFileSync(resolve(APP, "src/features/appointments/InlineNoteField.tsx"), "utf8");
    assert.match(note, /marginHorizontal: 12,/);
    assert.match(note, /paddingVertical: 7,/);
    assert.match(note, /fontSize: 13,/);

    const rows = readFileSync(resolve(APP, "src/components/ui/select-rows.tsx"), "utf8");
    assert.match(rows, /minHeight: 52,/, "строка шторки больше не 52pt");
    assert.match(rows, /paddingHorizontal: 14,/);
    assert.match(rows, /gap: 12,/);
    assert.match(rows, /const CIRCLE = 28/, "кружок строки шторки больше не 28pt");
    assert.match(rows, /minHeight: 40,/, "поле поиска шторки больше не 40pt");
  });

  test("иконка сущности та же, что обещает каталог", () => {
    const expected: [string, string, string][] = [
      ["app/book/index.tsx", "UserRound", "клиент"],
      ["app/book/index.tsx", "Briefcase", "услуга"],
      ["src/features/clients/ObjectPickerSheet.tsx", "MapPin", "объект"],
      ["src/features/reference/LabelPickerSheet.tsx", "MapPin", "метка"],
      ["src/features/clients/TagPickerSheet.tsx", "Tag", "тег"],
      ["src/features/clients/ObjectFields.tsx", "MapPinned", "точка на карте"],
      ["src/features/clients/ObjectFields.tsx", "Send", "попросить адрес"],
      // ЗНАЧОК НАСТРОЙКИ ОДИН — ползунки. Здесь стояло «настройки блока —
      // ползунки, настройки списка — шестерёнка»; владелец снял это различие
      // 2026-09-10, глядя на лист категорий: «не шестерёнка, а вот эти
      // маленькие тумблеры». Обе двери ведут на страницу справочника, и
      // разный значок обещал разницу, которой нет.
      ["src/features/clients/ObjectFields.tsx", "Settings2", "настройки блока"],
      // Тип события выбирается блоком со шапкой и шторкой, как категория:
      // ползунков в шапке БЛОКА больше нет — дверь в справочник живёт в шапке
      // ШТОРКИ (владелец 2026-09-10). Сам значок настроек списка — `Settings2`,
      // «палочки с кружочками», а не шестерёнка (владелец 2026-09-10).
      ["src/features/appointments/EventTypeBlock.tsx", "Tag", "тип события"],
      ["src/features/finances/CategoryBlock.tsx", "Tag", "категория"],
      ["src/components/ui/PickerSheet.tsx", "Settings2", "настройки списка"],
      ["src/components/ui/ValuePickerSheet.tsx", "Settings2", "настройки списка"],
    ];
    for (const [path, icon, role] of expected) {
      const source = readFileSync(resolve(APP, path), "utf8");
      assert.match(
        source,
        new RegExp(`\\b${icon}\\b`),
        `${path}: пропала иконка ${icon} (${role}) — каталог обещает её`,
      );
    }
  });

  test("каталог назван в правилах, иначе его никто не откроет", () => {
    const agents = readFileSync(resolve(ROOT, "AGENTS.md"), "utf8");
    assert.match(agents, /BLOCKS\.md/);
  });
});
