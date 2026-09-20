import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Appointment, AppointmentService } from "@babun/shared/local/appointments";
import type { Receipt } from "@babun/shared/local/finance/receipt";
import { formatInvoiceDate, formatInvoiceMoney } from "@/features/invoices/format";
import {
  buildReceiptDocument,
  receiptCoversFullAmount,
  receiptLinesFromAppointment,
  receiptLinesFromInvoice,
} from "./receipt-document";

/** Тот же приём, что у `invoice-generator.test.ts`: партиал + `as unknown as
 *  Appointment` — модель записи большая, а этим тестам нужны только несколько
 *  полей. */
function appointment(patch: Partial<Appointment> = {}): Appointment {
  return {
    id: "apt-1",
    date: "2026-07-20",
    time_start: "09:00",
    time_end: "11:00",
    client_id: "client-1",
    team_id: "team-1",
    kind: "work",
    status: "completed",
    total_amount: 100,
    services: [],
    global_discount: null,
    discount_amount: 0,
    comment: "",
    ...patch,
  } as unknown as Appointment;
}

function service(patch: Partial<AppointmentService> = {}): AppointmentService {
  const quantity = patch.quantity ?? 1;
  const pricePerUnit = patch.pricePerUnit ?? 50;
  return {
    serviceId: "svc-1",
    quantity,
    pricePerUnit,
    originalPrice: pricePerUnit,
    totalPrice: quantity * pricePerUnit,
    duration: 60,
    ...patch,
  };
}

const receipt: Receipt = {
  id: "receipt-1",
  tenant_id: "tenant-1",
  number: "RC-2026-007",
  year: 2026,
  seq: 7,
  issued_on: "2026-07-20",
  amount: 119,
  currency: "EUR",
  vat_rate: 19,
  vat_amount: 19,
  client_id: "client-1",
  appointment_id: null,
  invoice_id: null,
  transaction_id: "transaction-1",
  account_id: "account-1",
  payment_method: "transfer",
  status: "issued",
  seller_snapshot: { name: "AC Service Ltd", address: "Limassol" },
  lines: null,
  client_snapshot: { name: "Иван Петров", phone: "+357 111111" },
  created_at: "2026-07-20T08:00:00Z",
};

describe("receipt document", () => {
  it("prints the tax row only when the receipt actually carries VAT", () => {
    const withVat = buildReceiptDocument(receipt);
    // «VAT 19%», без «в т.ч.» — владелец 2026-09-20 дал ровно эту строку и
    // тем же днём заменил слово «НДС» на «VAT».
    assert.deepEqual(withVat.vat, { label: "VAT 19% в сумме", value: formatInvoiceMoney(19, "EUR") });

    const noVatFields = buildReceiptDocument({ ...receipt, vat_rate: null, vat_amount: null });
    assert.equal(noVatFields.vat, null);

    // Возврат может обнулить сумму налога до нуля, а не до null — ноль тоже
    // не печатается, иначе документ без налога говорил бы «VAT €0».
    const zeroVat = buildReceiptDocument({ ...receipt, vat_amount: 0 });
    assert.equal(zeroVat.vat, null);
  });

  it("marks a voided receipt without hiding its number — a live one prints no stamp at all", () => {
    const voided = buildReceiptDocument({ ...receipt, status: "void" });
    assert.equal(voided.voidLabel, "Аннулирован");
    assert.equal(voided.number, receipt.number);

    // «оплачено тоже давай не писать» (владелец 2026-09-20) — живой чек не
    // печатает штамп вовсе, не только другое слово.
    const issued = buildReceiptDocument(receipt);
    assert.equal(issued.voidLabel, null);
  });

  it("formats money the same way the invoice does, and prints the date as digits", () => {
    const doc = buildReceiptDocument(receipt);
    assert.equal(doc.amount, formatInvoiceMoney(receipt.amount, receipt.currency));

    // Дата чека — цифрами и полностью («дату оставляем, только давай дату
    // цифрами полностью сделаем», владелец 2026-09-20), НЕ словом через
    // `formatInvoiceDate` — тот форматтер остаётся инвойсу и не трогается.
    assert.equal(doc.issuedOn, "20.07.2026");
    assert.notEqual(doc.issuedOn, formatInvoiceDate(receipt.issued_on));

    // Валюта — свойство ЧЕКА, а не приложения: другой код печатается другим
    // символом, и оба обязаны идти через один форматтер.
    const usd = buildReceiptDocument({ ...receipt, currency: "USD", amount: 1234.5 });
    assert.equal(usd.amount, formatInvoiceMoney(1234.5, "USD"));
    assert.notEqual(usd.amount, doc.amount);
  });

  it("день и месяц однозначной даты дополняются нулём слева", () => {
    const doc = buildReceiptDocument({ ...receipt, issued_on: "2026-01-05" });
    assert.equal(doc.issuedOn, "05.01.2026");
  });

  it("reads seller only from the immutable snapshot — client is not on the document", () => {
    const doc = buildReceiptDocument(receipt);
    assert.equal(doc.seller.name, "AC Service Ltd");
    assert.deepEqual(doc.seller.lines, ["Limassol"]);
    // «клиент убираем» (владелец 2026-09-20) — поля с клиентом на документе
    // нет вовсе, это не «пустая строка», которую можно случайно напечатать.
    assert.equal("clientName" in doc, false);

    const noSeller = buildReceiptDocument({ ...receipt, seller_snapshot: {} });
    assert.equal(noSeller.seller.name, "Продавец не указан");
    assert.deepEqual(noSeller.seller.lines, []);
  });

  it("способа оплаты на документе нет вовсе — ни у чека с ним, ни у чека без", () => {
    // «оплата давай не писать» (владелец 2026-09-20): поле снято с модели,
    // а не просто скрыто в шаблоне — второго пути его напечатать не остаётся.
    const withMethod = buildReceiptDocument(receipt); // receipt.payment_method === "transfer"
    assert.equal("paymentMethod" in withMethod, false);

    const withoutMethod = buildReceiptDocument({ ...receipt, payment_method: null });
    assert.equal("paymentMethod" in withoutMethod, false);
  });

  it("без переданных строк печатается ровно как раньше — пустой перечень, без итога и скидки", () => {
    const doc = buildReceiptDocument(receipt);
    assert.deepEqual(doc.lines, []);
    assert.equal(doc.linesTotal, null);
    assert.equal(doc.discount, null);
  });
});

describe("receiptCoversFullAmount", () => {
  it("совпадение до цента — да, частичный платёж — нет", () => {
    assert.equal(receiptCoversFullAmount(100, 100), true);
    // Шум плавающей точки не должен запрещать полный перечень.
    assert.equal(receiptCoversFullAmount(99.999999, 100), true);
    assert.equal(receiptCoversFullAmount(50, 100), false);
    assert.equal(receiptCoversFullAmount(150, 100), false);
  });
});

describe("receiptLinesFromAppointment — строки из снимка услуг записи", () => {
  it("услуги идут своими строками тем же генератором, что и счёт по записи", () => {
    const apt = appointment({
      total_amount: 160,
      services: [
        service({
          serviceId: "svc-clean",
          serviceName: "Чистка сплит-системы",
          quantity: 2,
          pricePerUnit: 30,
        }),
        service({
          serviceId: "svc-install",
          serviceName: "Монтаж внутреннего блока",
          quantity: 1,
          pricePerUnit: 100,
        }),
      ],
    });
    const { lines, discountAmount } = receiptLinesFromAppointment(apt);
    assert.deepEqual(lines, [
      { name: "Чистка сплит-системы", qty: 2, unit: null, unitPrice: 30, sum: 60 },
      { name: "Монтаж внутреннего блока", qty: 1, unit: null, unitPrice: 100, sum: 100 },
    ]);
    assert.equal(discountAmount, undefined);
  });

  it("режим зафиксирован на «услуги» — настройка компании «одной строкой» перечень не разоружает", () => {
    const apt = appointment({
      total_amount: 160,
      services: [
        service({ serviceId: "svc-a", serviceName: "Услуга А", quantity: 2, pricePerUnit: 30 }),
        service({ serviceId: "svc-b", serviceName: "Услуга Б", quantity: 1, pricePerUnit: 100 }),
      ],
    });
    assert.equal(receiptLinesFromAppointment(apt).lines.length, 2);
  });

  // ЭТОТ ТЕСТ ПРОВЕРЯЛ ОШИБКУ. Он требовал, чтобы скидка ехала отдельной
  // заметкой, — и закреплял двойное вычитание: генератор уже ужал цены строк
  // по `total_amount`. Переписан по факту (аудит бумаги 2026-09-20).
  it("скидка НЕ едет отдельно: она уже в ценах строк", () => {
    const apt = appointment({
      total_amount: 90,
      discount_amount: 10,
      services: [service({ serviceName: "Услуга", quantity: 1, pricePerUnit: 100 })],
    });
    const items = receiptLinesFromAppointment(apt);
    assert.equal(items.discountAmount, undefined);
    // Строка стоит уже 90, а не 100: скидка внутри цены.
    assert.equal(Math.round(items.lines[0]!.sum * 100), 9000);
  });

  it("без скидки заметки нет вовсе — не «0»", () => {
    const apt = appointment({
      discount_amount: 0,
      services: [service({ serviceName: "Услуга" })],
    });
    assert.equal(receiptLinesFromAppointment(apt).discountAmount, undefined);
  });

  it("без снимка имени берётся дефолтная строка генератора — как у счёта", () => {
    const apt = appointment({ total_amount: 50, services: [] });
    assert.deepEqual(receiptLinesFromAppointment(apt).lines, [
      { name: "Услуги", qty: 1, unit: null, unitPrice: 50, sum: 50 },
    ]);
  });
});

describe("receiptLinesFromInvoice — строки из выставленного инвойса", () => {
  it("суммы берутся готовыми, без повторного счёта", () => {
    const { lines } = receiptLinesFromInvoice([
      { title: "Чистка сплит-системы", qty: 2, unit: null, unit_price: 30, total: 60 },
      { title: "Монтаж", qty: 1, unit: "шт", unit_price: 100, total: 100 },
    ]);
    assert.deepEqual(lines, [
      { name: "Чистка сплит-системы", qty: 2, unit: null, unitPrice: 30, sum: 60 },
      { name: "Монтаж", qty: 1, unit: "шт", unitPrice: 100, sum: 100 },
    ]);
  });

  it("инвойс не несёт отдельной скидки — заметки в перечне нет", () => {
    const { discountAmount } = receiptLinesFromInvoice([
      { title: "Работа", qty: 1, unit: null, unit_price: 100, total: 100 },
    ]);
    assert.equal(discountAmount, undefined);
  });
});

describe("buildReceiptDocument с перечнем строк", () => {
  it("строки из записи печатаются, а итог работ сходится с суммой строк", () => {
    const lineItems = receiptLinesFromAppointment(
      appointment({
        total_amount: 119,
        services: [
          service({ serviceName: "Чистка", quantity: 1, pricePerUnit: 100 }),
          service({ serviceName: "Фильтр", quantity: 1, pricePerUnit: 19 }),
        ],
      }),
    );
    const doc = buildReceiptDocument(receipt, lineItems);
    assert.equal(doc.lines.length, 2);
    assert.equal(doc.lines[0].name, "Чистка");
    assert.equal(doc.lines[0].sum, formatInvoiceMoney(100, "EUR"));
    // ГЛАВНЫЙ ЗАКОН: итог работ обязан быть суммой напечатанных строк.
    assert.equal(doc.linesTotal, formatInvoiceMoney(119, "EUR"));
  });

  it("строки из инвойса печатаются и суммируются так же", () => {
    const lineItems = receiptLinesFromInvoice([
      { title: "Работа", qty: 1, unit: null, unit_price: 100, total: 100 },
      { title: "Материалы", qty: 1, unit: null, unit_price: 19, total: 19 },
    ]);
    const doc = buildReceiptDocument(receipt, lineItems);
    assert.equal(doc.lines.length, 2);
    assert.equal(doc.linesTotal, formatInvoiceMoney(119, "EUR"));
    // У инвойса скидки отдельной строкой нет — заметка молчит.
    assert.equal(doc.discount, null);
  });

  it("скидка печатается заметкой минусом — когда цены строк её ещё не учли", () => {
    // Такой перечень собирает РУЧНОЙ составитель: строки по прайсу, скидка
    // вычитается из итога. У чека по записи скидки в перечне нет вовсе —
    // см. соседний тест, цены там уже ужаты.
    const doc = buildReceiptDocument(
      { ...receipt, amount: 90 },
      {
        lines: [{ name: "Услуга", qty: 1, unit: null, unitPrice: 100, sum: 100 }],
        discountAmount: 10,
      },
    );
    assert.deepEqual(doc.discount, {
      label: "Скидка",
      value: `−${formatInvoiceMoney(10, "EUR")}`,
    });
  });

  it("аннулированный чек со строками не теряет ни штамп, ни перечень", () => {
    const lineItems = receiptLinesFromInvoice([
      { title: "Работа", qty: 1, unit: null, unit_price: 119, total: 119 },
    ]);
    const doc = buildReceiptDocument({ ...receipt, status: "void" }, lineItems);
    assert.equal(doc.voidLabel, "Аннулирован");
    assert.equal(doc.lines.length, 1);
    assert.equal(doc.linesTotal, formatInvoiceMoney(119, "EUR"));
  });

  it("без строк — как у чека без источника: пусто, без итога", () => {
    const doc = buildReceiptDocument(receipt, { lines: [] });
    assert.deepEqual(doc.lines, []);
    assert.equal(doc.linesTotal, null);
  });

  it("деньги строк форматируются той же функцией, что у инвойса, и другой валютой не путаются", () => {
    const lineItems = receiptLinesFromInvoice([
      { title: "Работа", qty: 1, unit: null, unit_price: 1234.5, total: 1234.5 },
    ]);
    const eur = buildReceiptDocument({ ...receipt, amount: 1234.5 }, lineItems);
    assert.equal(eur.lines[0].unitPrice, formatInvoiceMoney(1234.5, "EUR"));
    assert.equal(eur.lines[0].sum, formatInvoiceMoney(1234.5, "EUR"));

    const usd = buildReceiptDocument(
      { ...receipt, currency: "USD", amount: 1234.5 },
      lineItems,
    );
    assert.equal(usd.lines[0].sum, formatInvoiceMoney(1234.5, "USD"));
    assert.notEqual(usd.lines[0].sum, eur.lines[0].sum);
  });
});

describe("скидка не вычитается дважды (регрессия аудита 2026-09-20)", () => {
  // РЕГРЕССИЯ, НАЙДЕННАЯ АУДИТОМ БУМАГИ 2026-09-20. Генератор масштабирует
  // цены строк по `total_amount` — скидка уже в них. Пока чек передавал её ещё
  // и отдельной строкой, бумага не сходилась сама с собой: сумма работ минус
  // скидка не равнялась полученному.
  const discounted = appointment({
    total_amount: 180,
    discount_amount: 20,
    services: [service({ serviceName: "Чистка", quantity: 1, pricePerUnit: 200 })],
  });

  it("строки чека по записи уже содержат скидку, и второй строки нет", () => {
    const items = receiptLinesFromAppointment(discounted);
    assert.equal(items.discountAmount, undefined);
    const sum = items.lines.reduce((acc, line) => acc + line.sum, 0);
    assert.equal(Math.round(sum * 100), 18000);
  });

  it("бумага сходится сама с собой: работы минус скидка равны полученному", () => {
    const doc = buildReceiptDocument(
      { ...receipt, amount: 180 },
      receiptLinesFromAppointment(discounted),
    );
    assert.equal(doc.discount, null);
    assert.equal(doc.linesTotal, formatInvoiceMoney(180, "EUR"));
    assert.equal(doc.amount, formatInvoiceMoney(180, "EUR"));
  });
});

describe("реквизиты продавца доходят до бумаги (аудит 2026-09-20)", () => {
  // Снимок продавца хранит номер НДС, банк и счёт с тех пор, как появились
  // наборы реквизитов. Пока бумага их не читала, компания-клиент на Кипре не
  // могла провести такой чек: без VAT-номера продавца это не документ.
  const full = {
    ...receipt,
    seller_snapshot: {
      name: "ГИЛЮТА ТРЕЙДИНГ ЛТД",
      address: "Limassol, Cyprus",
      vat_number: "CY10123456X",
      reg_number: "HE 123456",
      iban: "CY17002001280000001200527600",
      bank_name: "Bank of Cyprus",
    },
  };

  it("печатает адрес, налоговый номер, регистрационный и банк со счётом", () => {
    const doc = buildReceiptDocument(full);
    assert.deepEqual(doc.seller.lines, [
      "Limassol, Cyprus",
      "VAT CY10123456X",
      "Рег. № HE 123456",
      "Bank of Cyprus · CY17002001280000001200527600",
    ]);
  });

  it("пустые реквизиты не оставляют пустых строк", () => {
    const doc = buildReceiptDocument({
      ...receipt,
      seller_snapshot: { name: "Фирма", address: "Никосия" },
    });
    assert.deepEqual(doc.seller.lines, ["Никосия"]);
  });

  it("банк без счёта и счёт без банка печатаются по одному, а не с точкой", () => {
    const onlyIban = buildReceiptDocument({
      ...receipt,
      seller_snapshot: { name: "Ф", iban: "CY17" },
    });
    assert.deepEqual(onlyIban.seller.lines, ["CY17"]);
  });
});
