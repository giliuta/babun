import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Appointment, AppointmentService } from "../appointments";
import {
  addDaysYmd,
  generateInvoiceFromAppointment,
  INVOICE_GENERATOR_DEFAULTS,
  type InvoiceGeneratorSettings,
} from "./invoice-generator";

const NAMES: Record<string, { name: string; description?: string | null }> = {
  "svc-clean": {
    name: "Чистка сплит-системы",
    description: "Промывка теплообменника, дренаж, антибактериальная обработка",
  },
  "svc-install": { name: "Монтаж внутреннего блока" },
};
const name = (id: string) => NAMES[id];

function service(patch: Partial<AppointmentService> = {}): AppointmentService {
  const quantity = patch.quantity ?? 1;
  const pricePerUnit = patch.pricePerUnit ?? 50;
  return {
    serviceId: "svc-clean",
    quantity,
    pricePerUnit,
    originalPrice: pricePerUnit,
    totalPrice: quantity * pricePerUnit,
    duration: 60,
    ...patch,
  };
}

function appointment(patch: Partial<Appointment> = {}): Appointment {
  return {
    id: "apt-1",
    date: "2026-08-10",
    time_start: "09:00",
    time_end: "11:00",
    client_id: "c-1",
    team_id: "team-1",
    kind: "work",
    status: "completed",
    total_amount: 100,
    services: [],
    global_discount: null,
    comment: "",
    ...patch,
  } as unknown as Appointment;
}

/** Сумма строк так, как её посчитает сам документ: `количество × цена`. */
const sum = (lines: { qty: number; unitPrice: number }[]) =>
  Math.round(
    lines.reduce((acc, l) => acc + Math.round(l.qty * l.unitPrice * 100), 0),
  ) / 100;

const settings = (
  patch: Partial<InvoiceGeneratorSettings> = {},
): InvoiceGeneratorSettings => ({ ...INVOICE_GENERATOR_DEFAULTS, ...patch });

describe("счёт по записи сходится с ней до цента", () => {
  test("услуги идут своими строками", () => {
    const draft = generateInvoiceFromAppointment(
      appointment({
        total_amount: 160,
        services: [
          service({ serviceId: "svc-clean", quantity: 2, pricePerUnit: 30 }),
          service({ serviceId: "svc-install", quantity: 1, pricePerUnit: 100 }),
        ],
      }),
      settings(),
      name,
    );
    assert.deepEqual(draft.lines, [
      {
        title: "Чистка сплит-системы",
        qty: 2,
        unitPrice: 30,
        description:
          "Промывка теплообменника, дренаж, антибактериальная обработка",
        unit: null,
      },
      {
        title: "Монтаж внутреннего блока",
        qty: 1,
        unitPrice: 100,
        description: null,
        unit: null,
      },
    ]);
    assert.equal(sum(draft.lines), 160);
  });

  test("скидка на визит не теряется — она в цене, а сумма равна итогу", () => {
    const draft = generateInvoiceFromAppointment(
      appointment({
        // Итог записи ниже прайса на €20: так закрыли визит.
        total_amount: 140,
        services: [
          service({ serviceId: "svc-clean", quantity: 2, pricePerUnit: 30 }),
          service({ serviceId: "svc-install", quantity: 1, pricePerUnit: 100 }),
        ],
      }),
      settings(),
      name,
    );
    assert.equal(sum(draft.lines), 140);
  });

  test("ручной итог не выводится из услуг, но счёт всё равно сходится", () => {
    const draft = generateInvoiceFromAppointment(
      appointment({
        total_amount: 250,
        services: [service({ quantity: 1, pricePerUnit: 50 })],
      }),
      settings(),
      name,
    );
    assert.equal(sum(draft.lines), 250);
  });

  test("невыразимый цент сворачивает позицию в одну штуку, а не врёт суммой", () => {
    // 100 ÷ 3 = 33,33 и обратно 99,99 — цент негде спрятать в «кол-во × цена».
    const draft = generateInvoiceFromAppointment(
      appointment({
        total_amount: 100,
        services: [service({ quantity: 3, pricePerUnit: 33.34 })],
      }),
      settings(),
      name,
    );
    assert.equal(sum(draft.lines), 100);
    assert.equal(draft.lines.length, 1);
    assert.equal(draft.lines[0].qty, 1);
    // Количество не пропало — оно ушло в название.
    assert.match(draft.lines[0].title, /× 3$/);
  });

  test("три услуги с делением на количество: сумма точная", () => {
    const draft = generateInvoiceFromAppointment(
      appointment({
        total_amount: 217,
        services: [
          service({ serviceId: "svc-clean", quantity: 3, pricePerUnit: 23 }),
          service({ serviceId: "svc-install", quantity: 7, pricePerUnit: 11 }),
          service({ serviceId: "svc-clean", quantity: 3, pricePerUnit: 24 }),
        ],
      }),
      settings(),
      name,
    );
    assert.equal(sum(draft.lines), 217);
  });
});

describe("режим «одной строкой» и вырожденные записи", () => {
  test("настройка total сводит визит в одну позицию", () => {
    const draft = generateInvoiceFromAppointment(
      appointment({
        total_amount: 160,
        comment: "Монтаж двух блоков",
        services: [
          service({ quantity: 2, pricePerUnit: 30 }),
          service({ serviceId: "svc-install", quantity: 1, pricePerUnit: 100 }),
        ],
      }),
      settings({ lineSource: "total" }),
      name,
    );
    assert.deepEqual(draft.lines, [
      { title: "Монтаж двух блоков", qty: 1, unitPrice: 160 },
    ]);
  });

  test("без услуг — одна строка с названием из настроек", () => {
    const draft = generateInvoiceFromAppointment(
      appointment({ total_amount: 90, services: [] }),
      settings({ defaultLineTitle: "Выездные работы" }),
      name,
    );
    assert.deepEqual(draft.lines, [
      { title: "Выездные работы", qty: 1, unitPrice: 90 },
    ]);
  });

  test("бесплатный визит не расписывается по прайсу", () => {
    const draft = generateInvoiceFromAppointment(
      appointment({
        total_amount: 0,
        services: [service({ quantity: 1, pricePerUnit: 0 })],
      }),
      settings(),
      name,
    );
    assert.equal(draft.lines.length, 1);
    assert.equal(sum(draft.lines), 0);
  });

  test("услуга, которой больше нет в справочнике, не выдумывает себе имя", () => {
    const draft = generateInvoiceFromAppointment(
      appointment({
        total_amount: 50,
        services: [service({ serviceId: "svc-deleted" })],
      }),
      settings({ defaultLineTitle: "Услуги" }),
      name,
    );
    assert.equal(draft.lines[0].title, "Услуги");
  });
});

describe("срок оплаты и приписка", () => {
  test("срок считается от дня записи по настройке", () => {
    const draft = generateInvoiceFromAppointment(
      appointment({ date: "2026-08-28" }),
      settings({ dueDays: 14 }),
      name,
    );
    assert.equal(draft.issuedOn, "2026-08-28");
    assert.equal(draft.dueOn, "2026-09-11");
  });

  test("ноль дней — оплата по факту, а не «срока нет»", () => {
    const draft = generateInvoiceFromAppointment(
      appointment({ date: "2026-08-10" }),
      settings({ dueDays: 0 }),
      name,
    );
    assert.equal(draft.dueOn, "2026-08-10");
  });

  test("приписка подставляется, пустая — не подставляется", () => {
    assert.equal(
      generateInvoiceFromAppointment(
        appointment(),
        settings({ footerNote: "  Оплата на IBAN CY00…  " }),
        name,
      ).notes,
      "Оплата на IBAN CY00…",
    );
    assert.equal(
      generateInvoiceFromAppointment(appointment(), settings({ footerNote: "   " }), name)
        .notes,
      null,
    );
  });

  test("клиент и команда приезжают из записи", () => {
    const draft = generateInvoiceFromAppointment(
      appointment({ client_id: "c-9", team_id: "team-9" }),
      settings(),
      name,
    );
    assert.equal(draft.clientId, "c-9");
    assert.equal(draft.teamId, "team-9");
  });
});

describe("addDaysYmd", () => {
  test("переходит через конец месяца и года", () => {
    assert.equal(addDaysYmd("2026-08-28", 7), "2026-09-04");
    assert.equal(addDaysYmd("2026-12-28", 7), "2027-01-04");
    assert.equal(addDaysYmd("2026-02-27", 2), "2026-03-01");
  });
});


describe("цена за всю строку доезжает до счёта", () => {
  test("«три комнаты за 100» печатается сотней, а не 3 × 33,33", () => {
    // Прайс с 2026-08-21 спрашивает цену ЗА ВСЮ СТРОКУ, поэтому неделимый цент
    // стал обычным делом, а не редкостью. Раньше такая позиция уезжала в счёт
    // как «3 × €33,33 = €99,99», и остаток тихо утекал в последнюю строку:
    // документ сходился с записью, но сама позиция называла не ту сумму,
    // которую человек назначил.
    const draft = generateInvoiceFromAppointment(
      appointment({
        total_amount: 130,
        services: [
          service({ serviceId: "svc-clean", quantity: 3, pricePerUnit: 100 / 3 }),
          service({ serviceId: "svc-install", quantity: 1, pricePerUnit: 30 }),
        ],
      }),
      settings(),
      name,
    );

    assert.equal(draft.lines[0]?.title, "Чистка сплит-системы × 3");
    assert.equal(draft.lines[0]?.qty, 1);
    assert.equal(draft.lines[0]?.unitPrice, 100);
    assert.equal(draft.lines[1]?.title, "Монтаж внутреннего блока");
    assert.equal(draft.lines[1]?.qty, 1);
    assert.equal(draft.lines[1]?.unitPrice, 30);
    // Главный закон генератора не тронут: сумма строк сходится с итогом записи.
    assert.equal(sum(draft.lines), 130);
  });

  test("делимая строка количество не теряет", () => {
    // Схлопывание — крайняя мера, а не правило: где деление точное, клиент
    // по-прежнему видит «2 × €30».
    const draft = generateInvoiceFromAppointment(
      appointment({
        total_amount: 60,
        services: [service({ serviceId: "svc-clean", quantity: 2, pricePerUnit: 30 })],
      }),
      settings(),
      name,
    );
    assert.equal(draft.lines[0]?.title, "Чистка сплит-системы");
    assert.equal(draft.lines[0]?.qty, 2);
    assert.equal(draft.lines[0]?.unitPrice, 30);
    assert.equal(sum(draft.lines), 60);
  });
});

describe("единица измерения доезжает до бумаги клиента", () => {
  const withUnit = (id: string) =>
    id === "svc-trass"
      ? { name: "Трасса", unit: "м" }
      : NAMES[id];

  test("строка счёта несёт единицу услуги", () => {
    const lines = generateInvoiceFromAppointment(
      appointment({
        total_amount: 80,
        services: [
          service({ serviceId: "svc-trass", quantity: 4, pricePerUnit: 20 }),
        ],
      }),
      settings(),
      withUnit,
    ).lines;

    assert.equal(lines.length, 1);
    assert.equal(lines[0].qty, 4);
    assert.equal(lines[0].unit, "м");
  });

  test("схлопнутая позиция уносит единицу В НАЗВАНИЕ, а не теряет её", () => {
    // 100 на трёх невыразимо в «количество × цена» (33,33 × 3 = 99,99),
    // поэтому строка сворачивается в одну штуку — и метры обязаны переехать
    // в заголовок, иначе число снова становится безымянным.
    const lines = generateInvoiceFromAppointment(
      appointment({
        total_amount: 100,
        services: [
          service({ serviceId: "svc-trass", quantity: 3, pricePerUnit: 33.33 }),
        ],
      }),
      settings(),
      withUnit,
    ).lines;

    assert.equal(lines.length, 1);
    assert.equal(lines[0].qty, 1);
    assert.equal(lines[0].title, "Трасса × 3 м");
    assert.equal(lines[0].unit, null);
    assert.equal(sum(lines), 100);
  });

  test("услуга без единицы печатается как раньше — голым числом", () => {
    const lines = generateInvoiceFromAppointment(
      appointment({
        total_amount: 100,
        services: [service({ quantity: 2, pricePerUnit: 50 })],
      }),
      settings(),
      name,
    ).lines;

    assert.equal(lines[0].unit, null);
  });
});

describe("имя услуги переживает удаление из прайса", () => {
  // Владелец 2026-08-29: «удаляю услугу — в истории она полностью хранится,
  // проверь пожалуйста, чтоб это было действительно так».
  //
  // Имя работы кладётся в САМУ ЗАПИСЬ при сохранении (`serviceName`), и счёт
  // обязан читать его первым. Каталог отвечает «как называется СЕЙЧАС», а на
  // стёртой услуге не отвечает вовсе.
  const emptyCatalog = () => undefined;

  test("услуги в прайсе больше нет — счёт печатает имя из записи", () => {
    const draft = generateInvoiceFromAppointment(
      appointment({
        total_amount: 100,
        services: [service({ serviceName: "Чистка сплит-системы" })],
      }),
      settings(),
      emptyCatalog,
    );
    assert.equal(draft.lines[0].title, "Чистка сплит-системы");
  });

  test("услугу переименовали — счёт печатает имя НА ДЕНЬ ВИЗИТА", () => {
    const draft = generateInvoiceFromAppointment(
      appointment({
        total_amount: 100,
        services: [service({ serviceName: "Чистка" })],
      }),
      settings(),
      () => ({ name: "Чистка сплит-системы", description: null, unit: null }),
    );
    assert.equal(draft.lines[0].title, "Чистка");
  });

  test("снимка нет (запись до 25.08.2026) — берётся каталог", () => {
    const draft = generateInvoiceFromAppointment(
      appointment({ total_amount: 100, services: [service()] }),
      settings(),
      () => ({ name: "Чистка", description: null, unit: null }),
    );
    assert.equal(draft.lines[0].title, "Чистка");
  });

  test("нет ни снимка, ни каталога — дефолтная строка, а не пустая", () => {
    const draft = generateInvoiceFromAppointment(
      appointment({ total_amount: 100, services: [service()] }),
      settings({ defaultLineTitle: "Работы" }),
      emptyCatalog,
    );
    assert.equal(draft.lines[0].title, "Работы");
  });

  test("единица тоже из снимка", () => {
    const draft = generateInvoiceFromAppointment(
      appointment({
        total_amount: 100,
        services: [service({ quantity: 2, serviceName: "Обмотка", unit: "м" })],
      }),
      settings(),
      emptyCatalog,
    );
    assert.equal(draft.lines[0].unit, "м");
  });
});
