import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// АУДИТ ФОРМЫ ЗАПИСИ, ИНВОЙСОВ И SMS 03.10 — сторожа на сборку экранов;
// чистые правила (цена лестницы, поля партнёра, части SMS) проверены своими
// тестами рядом с ними.
const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(resolve(here, "..", rel), "utf8");
const app = (rel: string) => readFileSync(resolve(here, "../../../app", rel), "utf8");

describe("аудит записи, инвойсов и SMS 03.10", () => {
  test("оплата судит «визит начался» по часам команды записи", () => {
    assert.match(src("appointments/business-now.ts"), /export function useBusinessNow\(teamId\?: string \| null\)/);
    assert.match(src("appointments/PaymentBlock.tsx"), /useBusinessNow\(teamId\)/);
  });

  test("маршрут листа выезда и события — общей шторкой карт", () => {
    for (const file of ["appointments/CrewWorkRecord.tsx", "appointments/CrewAppointmentSheet.tsx"]) {
      const body = src(file);
      assert.doesNotMatch(body, /maps\.apple\.com/, file);
      assert.match(body, /onPress=\{\(\) => route\.open\(null, address\)\}/, file);
      assert.match(body, /\{route\.sheet\}/, file);
    }
  });

  test("повтор SMS — той же командой и на тот же номер", () => {
    const sheet = src("sms/SmsMessageSheet.tsx");
    assert.match(sheet, /teamId: m\.teamId,\s*phone: m\.toPhone\.trim\(\) \|\| null,/);
  });

  test("инвойс: отказ выпуска виден в листе, VAT без номера ловится заранее", () => {
    const editor = src("invoices/InvoiceEditor.tsx");
    assert.match(editor, /error=\{error\}/);
    assert.match(editor, /vatMode !== "off" && rate > 0 && pickedCompany && !pickedCompany\.vat_number\?\.trim\(\)/);
    assert.match(src("invoices/InvoicePreviewSheet.tsx"), /\) : error \? \(/);
    assert.match(src("invoices/InvoiceRequisitesBlock.tsx"), /if \(!editing\) onCompanyChange\(id\);/);
  });

  test("фото и видео записи: минута влезает, пачка не рвётся молча", () => {
    assert.match(src("appointments/use-file-pickers.ts"), /videoQuality: ImagePicker\.UIImagePickerControllerQualityType\.VGA640x480,/);
    const upload = src("appointments/appointment-photos.ts");
    const loop = upload.slice(upload.indexOf("for (let index = 0; index < selected.length"));
    assert.match(loop, /try \{[\s\S]{0,300}const bytes = await assetBytes\(asset, mime\);/);
    assert.ok(upload.indexOf("for (const asset of selected)") < upload.indexOf("for (let index = 0; index < selected.length"));
    assert.match(src("appointments/pending-files.ts"), /error instanceof RetryableAppointmentPhotoUploadError/);
  });

  test("форма записи: лестница, часы команды, снятый объект, команда при оплате", () => {
    const book = app("book/index.tsx");
    assert.match(book, /overrideWithQuantity\(p\[id\], qty, repriceable, catalog\.get\(id\)\)/);
    assert.match(book, /const businessNow = useBusinessNow\(teamId\);/);
    assert.match(book, /setLocationId\(null\);[\s\S]{0,400}if \(kind === "work"\) setAddress\(""\);/);
    assert.match(book, /if \(moneyHoldsClient\) \{\s*haptics\.warning\(\);\s*toast\("Команду не сменить/);
  });

  test("партнёр: один номер новой записи на форму, команда записи не меняется", () => {
    const book = app("book/index.tsx");
    assert.match(book, /patch: \{ \.\.\.buildPatch\(\), id: newRecordIdRef\.current \},/);
    assert.match(book, /const newRecordIdRef = useRef\(randomUuid\(\)\);/);
    assert.match(book, /teams=\{isMemberView && isEdit \? teams\.filter\(\(tm\) => tm\.id === teamId\) : teams\}/);
    assert.match(src("calendar/mutations.ts"), /if \(error && !isOwnRecordAlreadyCreated\(error\)\) \{/);
  });

  test("«Оплаты тарифа»: без подписки и без оплат нет двери в портал", () => {
    const screen = src("cabinet/TariffPaymentsScreen.tsx");
    // Подписка — только оплаченный не «навсегда»; на пробном и без тарифа
    // дверь вела в «Подписки ещё нет» (аудит Кабинета 03.10).
    assert.match(screen, /const hasSubscription = tariffState\.paid && !tariffState\.forever;/);
    assert.match(screen, /\{!hasSubscription && months\.length === 0 \? null : \(/);
  });

  test("SMS из карточки: «ближайшая запись» — по часам бизнеса", () => {
    const card = app("(dashboard)/clients/[id].tsx");
    assert.match(card, /today: now\.ymd,\s*nowHm: now\.hm,/);
  });
});
