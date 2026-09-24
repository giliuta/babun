import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { layoutClientFiles } from "./client-files";

// БЛОК «ФАЙЛЫ» НА СТРАНИЦЕ КЛИЕНТА (владелец 22.09: «уберём полностью блок
// документации и просто туда вставим, как у нас файлы, как везде хранятся
// файлы»). Две половины: чистое правило отбора и порядка — вызовом, и
// проводка — по исходникам (экран тянет react-native, которого в node:test
// нет). Главное, что сторожится: у клиента тот же блок, что у записи, собран
// из ТЕХ ЖЕ плиток и того же листа, а «Документации» больше нет.

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative: string) => readFileSync(resolve(here, relative), "utf8");

const att = (id: string, mime: string, at: string) => ({ id, mime_type: mime, created_at: at });

describe("что показывает блок «Файлы» клиента", () => {
  test("снимки — квадратами, прочее — плашками, свежие сверху", () => {
    const layout = layoutClientFiles({
      attachments: [
        att("old-photo", "image/jpeg", "2026-08-01T10:00:00Z"),
        att("contract", "application/pdf", "2026-09-10T10:00:00Z"),
      ],
      visitPhotos: [{ id: "visit", created_at: "2026-09-15T09:00:00Z" }],
      invoices: [{ id: "inv", status: "issued", kind: "invoice", issued_on: "2026-09-20", created_at: "2026-09-20T08:00:00Z" }],
      receipts: [{ id: "rc", status: "issued", issued_on: "2026-08-14", created_at: "2026-08-14T12:00:00Z" }],
    });
    assert.deepEqual(layout.media.map((m) => m.item.id), ["visit", "old-photo"]);
    assert.deepEqual(layout.papers.map((p) => p.item.id), ["inv", "contract", "rc"]);
    // «Все файлы» считает только то, что на той странице: вложения и фото
    // визитов (3). Инвойс и чек — бумаги, у них своя страница.
    assert.equal(layout.total, 3);
    assert.equal(layout.hidden, 0);
    assert.equal(layout.hiddenPapers, 0);
  });

  test("аннулированные бумаги и кредит-ноты — как у записи, не файлы", () => {
    const layout = layoutClientFiles({
      attachments: [],
      visitPhotos: [],
      invoices: [
        { id: "void", status: "void", issued_on: "2026-09-01" },
        { id: "cancelled", status: "cancelled", issued_on: "2026-09-01" },
        { id: "note", status: "issued", kind: "credit_note", issued_on: "2026-09-02" },
        { id: "live", status: "paid", issued_on: "2026-09-03" },
      ],
      receipts: [
        { id: "rc-void", status: "void", issued_on: "2026-09-01" },
        { id: "rc", status: "issued", issued_on: "2026-09-01" },
      ],
    });
    assert.deepEqual(layout.papers.map((p) => p.item.id), ["live", "rc"]);
    assert.equal(layout.total, 0);
    assert.equal(layout.hiddenPapers, 0);
  });

  test("бумаги сверх плашек — в «Счета и чеки», а не в число «Все файлы»", () => {
    const layout = layoutClientFiles(
      {
        attachments: [],
        visitPhotos: [],
        invoices: Array.from({ length: 4 }, (_, i) => ({
          id: `inv${i}`,
          status: "issued",
          kind: "invoice",
          issued_on: `2026-09-0${i + 1}`,
        })),
        receipts: [],
      },
      { media: 8, papers: 3 },
    );
    assert.equal(layout.papers.length, 3);
    assert.equal(layout.hiddenPapers, 1);
    assert.equal(layout.total, 0);
    assert.equal(layout.hidden, 0);
  });

  test("много файлов — первые, остальное за «Все файлы · N»", () => {
    const layout = layoutClientFiles(
      {
        attachments: [
          ...Array.from({ length: 5 }, (_, i) => att(`p${i}`, "image/png", `2026-09-0${i + 1}T00:00:00Z`)),
          ...Array.from({ length: 4 }, (_, i) => att(`d${i}`, "text/plain", `2026-08-0${i + 1}T00:00:00Z`)),
        ],
        visitPhotos: [],
        invoices: [],
        receipts: [],
      },
      { media: 3, papers: 2 },
    );
    assert.deepEqual(layout.media.map((m) => m.item.id), ["p4", "p3", "p2"]);
    assert.deepEqual(layout.papers.map((p) => p.item.id), ["d3", "d2"]);
    assert.equal(layout.total, 9);
    assert.equal(layout.hidden, 4);
  });

  test("пусто — пусто: блок держит одна дверь «Добавить»", () => {
    const layout = layoutClientFiles({ attachments: [], visitPhotos: [], invoices: [], receipts: [] });
    assert.equal(layout.total, 0);
    assert.equal(layout.hidden, 0);
  });
});

describe("у клиента тот же блок «Файлы», что у записи", () => {
  const block = () => read("blocks/ClientFilesBlock.tsx");
  const profile = () => read("ClientProfileBlocks.tsx");
  const record = () => read("../appointments/AppointmentFilesBlock.tsx");

  test("«Документации» на странице клиента больше нет", () => {
    assert.equal(existsSync(resolve(here, "blocks/DocumentationBlock.tsx")), false);
    assert.doesNotMatch(profile(), /DocumentationBlock/);
    assert.doesNotMatch(profile() + block(), /title="Документация"/);
  });

  test("страница ставит блок «Файлы»; в черновике — только его дверь", () => {
    assert.match(profile(), /import ClientFilesBlock from "@\/features\/clients\/blocks\/ClientFilesBlock"/);
    assert.match(profile(), /\{!draft && showDocuments \? \(\s*<ClientFilesBlock\s/);
    assert.match(block(), /<SectionCard title="Файлы">/);
  });

  test("плитки, плашки и лист — общие с записью, не копии", () => {
    const shared = /import \{[^}]*\bDocumentPill\b[^}]*\bPhotoTile\b[^}]*\} from "@\/features\/appointments\/AppointmentFileTiles"/;
    assert.match(block(), shared);
    assert.match(block(), /import \{ FileAddSheet \} from "@\/features\/appointments\/FileAddSheet"/);
    for (const tag of ["<PhotoTile", "<DocumentPill", "<FileAddSheet"]) {
      assert.ok(block().includes(tag), `блок клиента не ставит ${tag}`);
    }
    // Своей анатомии у блока клиента нет: ни плитки, ни второго листа.
    assert.doesNotMatch(block(), /function (PhotoTile|DocumentPill|FileAddSheet)\b/);
    assert.doesNotMatch(block(), /PickerSheet|<Image\b|<Modal\b/);
    // И запись берёт то же самое оттуда же — пункты листа живут в одном месте.
    assert.match(record(), /from "\.\/AppointmentFileTiles"/);
    assert.match(record(), /import \{ FileAddSheet \} from "\.\/FileAddSheet"/);
    assert.doesNotMatch(record(), /Снять фото или видео/);
  });

  test("«Добавить» кладёт во вложения клиента и стоит только при праве менять", () => {
    // Без второго аргумента — без записи: файл ложится к клиенту.
    assert.match(block(), /useUploadAttachments\(clientId\)/);
    assert.doesNotMatch(block(), /useUploadAttachments\(clientId, /);
    assert.match(block(), /\{canChange \? \([\s\S]{0,120}<ChooseRow[\s\S]{0,80}label="Добавить файл"/);
    assert.match(profile(), /canChange=\{caps\.edit && caps\.files\}/);
  });
});
