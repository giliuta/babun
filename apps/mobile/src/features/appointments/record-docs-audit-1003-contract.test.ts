import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { readModuleSource } from "@/lib/module-source";
import { invoiceEditorSource } from "../invoices/invoice-editor/editor-source";
import { bookFormSource } from "./book-form/source-for-tests";
import { clientCardSource } from "../clients/card/source-for-tests";

// СТОРОЖА ФОРМЫ ЗАПИСИ, ИНВОЙСОВ И SMS — сторожа на сборку экранов;
// чистые правила (цена лестницы, поля партнёра, части SMS) проверены своими
// тестами рядом с ними.
const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(resolve(here, "..", rel), "utf8");

describe("аудит записи, инвойсов и SMS 03.10", () => {
  test("оплата судит «визит начался» по часам команды записи", () => {
    assert.match(src("appointments/business-now.ts"), /export function useBusinessNow\(teamId\?: string \| null\)/);
    const block = readModuleSource(resolve(here, "PaymentBlock.tsx"), resolve(here, "payment-block"));
    assert.match(block, /useBusinessNow\(teamId\)/);
  });

  test("маршрут вольного адреса события — общей кнопкой карт", () => {
    // Записи и события открываются одной страницей /book; адрес без объекта
    // ведёт в карты той же кнопкой, что строка объекта, а не ссылкой Apple.
    const body = src("appointments/book-form/EventObjectBlock.tsx");
    assert.doesNotMatch(body, /maps\.apple\.com/);
    assert.match(body, /trailing=\{<ObjectRouteButton address=\{eventAddress\} teamId=\{teamId\} \/>\}/);
  });

  test("повтор SMS — той же командой и на тот же номер", () => {
    const sheet = src("sms/SmsMessageSheet.tsx");
    assert.match(sheet, /teamId: m\.teamId,\s*phone: m\.toPhone\.trim\(\) \|\| null,/);
  });

  test("инвойс: отказ выпуска виден в листе, VAT без номера ловится заранее", () => {
    // The form is `InvoiceEditor.tsx` plus its `invoice-editor/` folder.
    const editor = invoiceEditorSource();
    assert.match(editor, /error=\{error\}/);
    assert.match(editor, /vatMode !== "off" && rate > 0 && pickedCompany && !pickedCompany\.vat_number\?\.trim\(\)/);
    assert.match(src("invoices/InvoicePreviewSheet.tsx"), /\) : error \? \(/);
    assert.match(src("invoices/InvoiceRequisitesBlock.tsx"), /if \(!editing\) onCompanyChange\(id\);/);
  });

  test("фото и видео записи: камера не пишет видео, пачка не рвётся молча", () => {
    // Минуту видео с камеры (VGA, чтобы влезла в 50 МБ) снимать целиком нельзя:
    // видео пишет звук, а микрофона в сборке нет — на живом iPhone
    // камера падала. Видео приходит только из галереи; сторож — в
    // appointment-photo-picker-contract.test.ts.
    assert.match(src("appointments/use-file-pickers.ts"), /launchCameraAsync\(\{\s*mediaTypes: \["images"\],/);
    const upload = src("appointments/appointment-photos.ts");
    const loop = upload.slice(upload.indexOf("for (let index = 0; index < selected.length"));
    assert.match(loop, /try \{[\s\S]{0,300}const bytes = await assetBytes\(asset, mime\);/);
    assert.ok(upload.indexOf("for (const asset of selected)") < upload.indexOf("for (let index = 0; index < selected.length"));
    assert.match(src("appointments/pending-files.ts"), /error instanceof RetryableAppointmentPhotoUploadError/);
  });

  test("форма записи: лестница, часы команды, снятый объект, команда при оплате", () => {
    const book = bookFormSource();
    assert.match(book, /overrideWithQuantity\(p\[id\], qty, repriceable, catalog\.get\(id\)\)/);
    assert.match(book, /const businessNow = useBusinessNow\(teamId\);/);
    assert.match(book, /setLocationId\(null\);[\s\S]{0,400}if \(kind === "work"\) setAddress\(""\);/);
    assert.match(book, /if \(moneyHoldsClient\) \{\s*haptics\.warning\(\);\s*toast\("Команду не сменить/);
  });

  test("партнёр: один номер новой записи на форму, команда записи не меняется", () => {
    const book = bookFormSource();
    assert.match(book, /patch: \{ \.\.\.buildPatch\(\), id: newRecordIdRef\.current \},/);
    assert.match(book, /const newRecordIdRef = useRef\(randomUuid\(\)\);/);
    assert.match(book, /teams=\{isMemberView && isEdit \? teams\.filter\(\(tm\) => tm\.id === teamId\) : teams\}/);
    assert.match(readModuleSource(resolve(here, "../calendar/mutations.ts")), /if \(error && !isOwnRecordAlreadyCreated\(error\)\) \{/);
  });

  test("«Оплаты тарифа»: без подписки и без оплат нет двери в портал", () => {
    const screen = src("cabinet/TariffPaymentsScreen.tsx");
    // Подписка — только оплаченный не «навсегда»; на пробном и без тарифа
    // дверь вела в «Подписки ещё нет».
    assert.match(screen, /const hasSubscription = tariffState\.paid && !tariffState\.forever;/);
    // Дверь — только владельцу: партнёр с «Оплатами тарифа» видит
    // оплаты, но подпиской не управляет. И только на сайте: в приложении из
    // магазина двери в Stripe нет (`lib/pay-here.ts`).
    assert.match(screen, /\{!CAN_PAY_HERE \|\| !owner \|\| \(!hasSubscription && months\.length === 0\) \? null : \(/);
  });

  test("SMS из карточки: «ближайшая запись» — по часам бизнеса", () => {
    const card = clientCardSource();
    assert.match(card, /today: now\.ymd,\s*nowHm: now\.hm,/);
  });
});
