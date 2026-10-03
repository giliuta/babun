import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { clientFileTimeline, fileDay, fileTime, groupFilesByDay } from "./client-files";

// ФАЙЛЫ КЛИЕНТА — ЛЕНТОЙ ПО ДНЯМ, КАК «ИСТОРИЯ» (владелец 03.10: «файлы —
// как история, по датам… файлы, чеки, инвойсы — полноценные блоки, чтобы
// можно было сразу открывать»). Две половины: чистое правило ленты — вызовом,
// и проводка — по исходникам (экран тянет react-native, которого в node:test
// нет).

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative: string) => readFileSync(resolve(here, relative), "utf8");

const att = (id: string, mime: string, at: string) => ({ id, mime_type: mime, created_at: at });
const inv = (id: string, issued_on: string, status = "issued", kind?: string) => ({
  id,
  status,
  kind,
  issued_on,
  created_at: `${issued_on}T12:00:00`,
});
const rec = (id: string, issued_on: string, status = "issued") => ({
  id,
  status,
  issued_on,
  created_at: `${issued_on}T13:00:00`,
});
const local = (y: number, m: number, d: number, h = 10) => new Date(y, m - 1, d, h, 0).toISOString();

describe("лента файлов клиента", () => {
  test("все четыре источника — одной лентой, свежий день сверху", () => {
    const timeline = clientFileTimeline({
      attachments: [
        att("photo", "image/jpeg", local(2026, 8, 1)),
        att("contract", "application/pdf", local(2026, 9, 10)),
      ],
      visitPhotos: [{ id: "visit", created_at: local(2026, 9, 20) }],
      invoices: [inv("inv", "2026-09-15")],
      receipts: [rec("rc", "2026-09-15")],
    });
    assert.deepEqual(
      timeline.map((e) => `${e.type}:${e.item.id}`),
      ["visit:visit", "receipt:rc", "invoice:inv", "file:contract", "photo:photo"],
    );
    assert.equal(timeline[0].day, "2026-09-20");
  });

  test("снимок — фото, прочее вложение — файл", () => {
    const timeline = clientFileTimeline({
      attachments: [att("a", "image/png", local(2026, 9, 1)), att("b", "text/plain", local(2026, 9, 1, 9))],
      visitPhotos: [],
      invoices: [],
      receipts: [],
    });
    assert.deepEqual(timeline.map((e) => e.type), ["photo", "file"]);
  });

  test("аннулированные, отменённые и кредит-ноты в ленту не попадают", () => {
    const timeline = clientFileTimeline({
      attachments: [],
      visitPhotos: [],
      invoices: [inv("void", "2026-09-01", "void"), inv("cn", "2026-09-01", "issued", "credit_note"), inv("ok", "2026-09-01")],
      receipts: [rec("rv", "2026-09-01", "void"), rec("r", "2026-09-01")],
    });
    assert.deepEqual(timeline.map((e) => e.item.id).sort(), ["ok", "r"]);
  });

  test("документ встаёт в день своей даты, а не в день, когда его завели", () => {
    const [entry] = clientFileTimeline({
      attachments: [],
      visitPhotos: [],
      invoices: [{ id: "x", status: "issued", issued_on: "2026-08-05", created_at: "2026-08-09T10:00:00Z" }],
      receipts: [],
    });
    assert.equal(entry.day, "2026-08-05");
  });

  test("по дням — в порядке ленты; пусто — пусто", () => {
    const groups = groupFilesByDay([{ day: "2026-09-20" }, { day: "2026-09-20" }, { day: "2026-08-01" }]);
    assert.deepEqual(groups.map((g) => [g.day, g.items.length]), [["2026-09-20", 2], ["2026-08-01", 1]]);
    assert.deepEqual(groupFilesByDay([]), []);
  });

  test("день и время — по местным часам; у голой даты времени нет", () => {
    assert.equal(fileDay("2026-08-05"), "2026-08-05");
    assert.equal(fileDay(local(2026, 9, 3, 23)), "2026-09-03");
    assert.equal(fileTime(new Date(2026, 8, 3, 9, 5).toISOString()), "09:05");
    assert.equal(fileTime("2026-08-05"), "");
  });
});

describe("«Файлы» — как «История»: последний на карточке, вся лента на странице", () => {
  const block = () => read("blocks/ClientFilesBlock.tsx");
  const page = () => read("../../../app/(dashboard)/clients/attachments.tsx");
  const profile = () => read("ClientProfileBlocks.tsx");
  const row = () => read("ClientFileRow.tsx");

  test("«Документации» на странице клиента больше нет", () => {
    assert.equal(existsSync(resolve(here, "blocks/DocumentationBlock.tsx")), false);
    assert.doesNotMatch(profile(), /DocumentationBlock/);
    assert.doesNotMatch(profile() + block(), /title="Документация"/);
  });

  test("страница ставит блок «Файлы»; в черновике — только его дверь", () => {
    assert.match(profile(), /import ClientFilesBlock from "@\/features\/clients\/blocks\/ClientFilesBlock"/);
    assert.match(profile(), /\{!draft && a\.files\.show \? \(\s*<ClientFilesBlock\s/);
    assert.match(block(), /<SectionCard title="Файлы">/);
  });

  test("карточка — последний файл под заголовком своего дня; тап — страница всех", () => {
    assert.match(block(), /const last = files\.timeline\[0\] \?\? null;/);
    assert.match(block(), /<VisitDayHeader date=\{last\.day\} \/>/);
    assert.match(block(), /<ClientFileRow[\s\S]{0,160}onPress=\{openAll\}/);
    assert.match(block(), /pathname: "\/clients\/attachments", params: clientSubParams\(clientId, scope\)/);
    // Квадратов и пилюль записи на карточке клиента больше нет.
    assert.doesNotMatch(block(), /<PhotoTile|<DocumentPill/);
  });

  test("страница — дни заголовками, плашки, инвойсы и чеки в той же ленте", () => {
    assert.match(page(), /groupFilesByDay\(files\.timeline\)/);
    assert.match(page(), /<VisitDayHeader date=\{day\} \/>/);
    assert.match(page(), /<ClientFileRow/);
    // Второй двери «Выдано клиенту → Инвойсы и чеки» больше нет.
    // Ищется ДВЕРЬ, а не слово: почему её нет, сказано в самом файле.
    assert.doesNotMatch(page(), /title="Выдано клиенту"|label="Инвойсы и чеки"/);
  });

  test("тап открывает файл сразу: снимок, документ, инвойс, чек", () => {
    assert.match(page(), /case "photo":[\s\S]{0,200}setViewer/);
    assert.match(page(), /case "file":\s*void openAttachment\(entry\.item\)/);
    assert.match(page(), /case "invoice":\s*router\.push\(`\/invoices\/\$\{entry\.item\.id\}`/);
    assert.match(page(), /case "receipt":\s*setOpenReceipt\(entry\.item\)/);
  });

  test("удалить можно только своё вложение — свайпом, с вопросом", () => {
    assert.match(page(), /const own = entry\.type === "photo" \|\| entry\.type === "file";/);
    assert.match(page(), /own && canChange \? \(\s*<SwipeRow/);
    assert.match(page(), /confirmThen\(\s*"Удалить файл\?"/);
  });

  test("«Добавить» кладёт во вложения клиента и стоит только при праве менять", () => {
    const upload = read("use-client-files.ts");
    // Без второго аргумента — без записи: файл ложится к клиенту.
    assert.match(upload, /useUploadAttachments\(clientId\)/);
    assert.doesNotMatch(upload, /useUploadAttachments\(clientId, /);
    assert.match(block(), /canChange && !last \? \(\s*<ChooseRow[\s\S]{0,80}label="Добавить файл"/);
    assert.match(page(), /access\.files\.show && canChange \? \([\s\S]{0,200}label="Добавить файл"/);
    assert.match(profile(), /canChange=\{a\.files\.edit\}/);
    assert.match(read("card-access.ts"), /caps\.edit && caps\.files/);
  });

  test("справа у инвойса и чека — сумма цветом, у фото — сам снимок", () => {
    assert.match(row(), /entry\.item\.status === "paid" \? t\.success : t\.warning/);
    assert.match(row(), /image=\{image\}/);
  });
});
