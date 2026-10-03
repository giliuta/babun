import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  appointmentsToCsv,
  clientsToCsv,
  dateStamp,
  exportDialogTitle,
  exportFilename,
  financeTeamFilter,
  paidOf,
  serviceNames,
  sourceName,
  transactionsToCsv,
  type AppointmentExportRow,
  type ClientExportRow,
  type SourceRef,
  type TransactionExportRow,
} from "./data-export";

const BOM = "﻿";
const lines = (csv: string) => csv.replace(BOM, "").split("\r\n");
const cells = (line: string) => line.split(";");

const TEAMS = new Map([
  ["team-a", "Y&D"],
  ["team-b", "AirFix"],
]);

const SOURCES: SourceRef[] = [
  { id: "s1", name: "Соседи", key: null, team_id: "team-a" },
  { id: "s2", name: "Инстаграм Y&D", key: "instagram", team_id: "team-a" },
];

const client = (over: Partial<ClientExportRow>): ClientExportRow => ({
  id: "c1",
  full_name: "Андрей",
  phone: "+357 99 111222",
  email: "a@example.com",
  team_id: "team-a",
  city: "Лимассол",
  acquisition_source: "unknown",
  birthday: "1990-05-17",
  comment: "",
  notes: [],
  created_at: "2026-09-10T21:30:00+00:00",
  ...over,
});

const appointment = (over: Partial<AppointmentExportRow>): AppointmentExportRow => ({
  id: "a1",
  date: "2026-09-24",
  time_start: "10:00:00",
  time_end: "11:30:00",
  kind: "work",
  team_id: "team-a",
  client_id: "c1",
  status: "completed",
  services: [],
  total_amount: 120,
  paid_amount: 60.5,
  prepaid_amount: 0,
  payment_status: "partial",
  payments: [],
  payment: null,
  address: "ул. Ленина 5",
  comment: "",
  event_notes: "",
  ...over,
});

const transaction = (over: Partial<TransactionExportRow>): TransactionExportRow => ({
  id: "t1",
  type: "income",
  amount: 1234.5,
  occurred_on: "2026-09-24",
  occurred_time: "14:30:00",
  category_id: "cat",
  account_id: "acc",
  team_id: "team-a",
  client_id: "c1",
  notes: null,
  vat_amount: null,
  vat_mode: null,
  created_at: "2026-09-24T14:30:00+00:00",
  ...over,
});

describe("выгрузка клиентов", () => {
  const refs = { teams: TEAMS, sources: SOURCES };

  test("заголовок — девять колонок по порядку, с BOM", () => {
    const csv = clientsToCsv([], refs);
    assert.ok(csv.startsWith(BOM));
    assert.equal(
      lines(csv)[0],
      "Имя;Телефон;Почта;Команда;Метка;Источник;День рождения;Заметка;Создан",
    );
  });

  test("строка клиента: команда словом, дата создания без времени", () => {
    const [, row] = lines(clientsToCsv([client({})], refs));
    assert.deepEqual(cells(row), [
      "Андрей",
      "'+357 99 111222",
      "a@example.com",
      "Y&D",
      "Лимассол",
      "",
      "1990-05-17",
      "",
      // День создания — по часам телефона (21:30 UTC на Кипре уже 11-е).
      dateStamp(new Date("2026-09-10T21:30:00+00:00")),
    ]);
  });

  test("клиенты — по алфавиту", () => {
    const csv = clientsToCsv(
      [client({ id: "1", full_name: "Борис" }), client({ id: "2", full_name: "Анна" })],
      refs,
    );
    assert.deepEqual(
      lines(csv).slice(1).map((l) => cells(l)[0]),
      ["Анна", "Борис"],
    );
  });

  test("«;» и кавычки в заметке экранируются, строка остаётся одной ячейкой", () => {
    const [, row] = lines(clientsToCsv([client({ comment: 'звонить "после" 18;00' })], refs));
    assert.ok(row.includes('"звонить ""после"" 18;00"'));
  });

  test("заметки из карточки попадают в файл — все, по порядку (аудит Кабинета 03.10)", () => {
    // С 06.09 заметки живут списком `notes[]`; выгрузка читала одно старое
    // `comment` и печатала пустую ячейку.
    const notes = [
      { id: "n2", text: "ключ под ковриком", created_at: "2026-10-02T10:00:00Z" },
      { id: "n1", text: "звонить после 18", created_at: "2026-09-01T10:00:00Z" },
    ];
    const csv = clientsToCsv([client({ notes })], refs);
    assert.ok(csv.includes('"звонить после 18\nключ под ковриком"'), csv);
    // Текст импорта — первым, если заметкой не повторён.
    const both = clientsToCsv([client({ comment: "из CSV", notes })], refs);
    assert.ok(both.includes('"из CSV\nзвонить после 18\nключ под ковриком"'), both);
    // Пустой список и пустое старое поле — пустая ячейка.
    const [, row] = lines(clientsToCsv([client({})], refs));
    assert.ok(row.includes(";;"), row);
  });

  test("перевод строки в заметке не рвёт запись", () => {
    const csv = clientsToCsv([client({ comment: "первая\nвторая" })], refs);
    assert.ok(csv.includes('"первая\nвторая"'));
  });

  test("имя, начатое с «=», не исполняется формулой", () => {
    const [, row] = lines(clientsToCsv([client({ full_name: "=HYPERLINK(1)" })], refs));
    assert.ok(row.startsWith("'=HYPERLINK(1);"));
  });

  test("клиент без команды — пустая ячейка команды", () => {
    const [, row] = lines(clientsToCsv([client({ team_id: null })], refs));
    assert.equal(cells(row)[3], "");
  });
});

describe("источник клиента", () => {
  test("src:<id> — имя своего источника", () => {
    assert.equal(sourceName("src:s1", "team-a", SOURCES), "Соседи");
  });

  test("src:<id> удалённого источника — пусто, а не id", () => {
    assert.equal(sourceName("src:gone", "team-a", SOURCES), "");
  });

  test("старый ключ — источник этой же команды с тем же key", () => {
    assert.equal(sourceName("instagram", "team-a", SOURCES), "Инстаграм Y&D");
  });

  test("старый ключ у другой команды — готовое слово", () => {
    assert.equal(sourceName("instagram", "team-b", SOURCES), "Instagram");
    assert.equal(sourceName("referral", "team-a", SOURCES), "Рекомендация");
  });

  test("клиент без команды: ключ — готовое слово", () => {
    assert.equal(sourceName("instagram", null, SOURCES), "Instagram");
  });

  test("unknown и пусто — пустая ячейка", () => {
    assert.equal(sourceName("unknown", "team-a", SOURCES), "");
    assert.equal(sourceName("", "team-a", SOURCES), "");
    assert.equal(sourceName(null, "team-a", SOURCES), "");
  });

  test("незнакомый ключ печатается как есть, служебные имена объекта — тоже", () => {
    assert.equal(sourceName("tiktok", "team-a", SOURCES), "tiktok");
    assert.equal(sourceName("constructor", "team-a", SOURCES), "constructor");
  });
});

describe("имена услуг записи", () => {
  const catalog = new Map([["svc-1", "Чистка сплита"]]);

  test("имя на день записи важнее справочника", () => {
    assert.equal(
      serviceNames([{ serviceId: "svc-1", serviceName: "Чистка (старое имя)" }], catalog),
      "Чистка (старое имя)",
    );
  });

  test("нет имени в строке — из справочника; нигде нет — пропуск", () => {
    assert.equal(
      serviceNames(
        [{ serviceId: "svc-1" }, { serviceId: "svc-gone" }, { serviceId: "svc-1" }],
        catalog,
      ),
      "Чистка сплита, Чистка сплита",
    );
  });

  test("не массив и мусор в массиве — пусто", () => {
    assert.equal(serviceNames(null, catalog), "");
    assert.equal(serviceNames({ serviceId: "svc-1" }, catalog), "");
    assert.equal(serviceNames([1, "x", null, ["y"]], catalog), "");
  });
});

describe("выгрузка записей", () => {
  const refs = {
    teams: TEAMS,
    clients: new Map([["c1", "Андрей"]]),
    services: new Map([["svc-1", "Чистка"]]),
  };

  test("заголовок — двенадцать колонок по порядку", () => {
    assert.equal(
      lines(appointmentsToCsv([], refs))[0],
      "Дата;Начало;Конец;Вид;Команда;Клиент;Статус;Услуги;Сумма;Оплачено;Адрес;Заметка",
    );
  });

  test("работа: время без секунд, клиент по имени, суммы с запятой", () => {
    const [, row] = lines(
      appointmentsToCsv([appointment({ services: [{ serviceId: "svc-1" }] })], refs),
    );
    assert.deepEqual(cells(row), [
      "2026-09-24",
      "10:00",
      "11:30",
      "Запись",
      "Y&D",
      "Андрей",
      "Выполнена",
      "Чистка",
      "120,00",
      "60,50",
      "ул. Ленина 5",
      "",
    ]);
  });

  test("несколько услуг — через запятую в одной ячейке (в кавычках)", () => {
    const [, row] = lines(
      appointmentsToCsv(
        [appointment({ services: [{ serviceName: "Чистка" }, { serviceName: "Заправка" }] })],
        refs,
      ),
    );
    assert.equal(cells(row)[7], '"Чистка, Заправка"');
  });

  test("слова статусов", () => {
    const status = (value: string) =>
      cells(lines(appointmentsToCsv([appointment({ status: value })], refs))[1])[6];
    assert.equal(status("scheduled"), "Запланирована");
    assert.equal(status("completed"), "Выполнена");
    assert.equal(status("cancelled"), "Отменена");
    assert.equal(status("in_progress"), "В работе");
    assert.equal(status("postponed"), "postponed");
  });

  test("событие: вид «Событие», денег и клиента нет, заметки склеены", () => {
    const [, row] = lines(
      appointmentsToCsv(
        [
          appointment({
            kind: "personal",
            client_id: null,
            total_amount: 0,
            paid_amount: 0,
            address: "",
            comment: "Обед",
            event_notes: "с Антоном",
          }),
        ],
        refs,
      ),
    );
    const row12 = cells(row);
    assert.equal(row12[3], "Событие");
    assert.equal(row12[5], "");
    assert.equal(row12[8], "");
    assert.equal(row12[9], "");
    assert.equal(row12[11], "Обед — с Антоном");
  });

  test("вид event тоже «Событие»; клиент, которого нет в справочнике, — пусто", () => {
    const [, row] = lines(
      appointmentsToCsv([appointment({ kind: "event", client_id: "ghost" })], refs),
    );
    assert.equal(cells(row)[3], "Событие");
    assert.equal(cells(row)[5], "");
  });

  test("адрес с запятой и кавычки в заметке не ломают колонки", () => {
    const [, row] = lines(
      appointmentsToCsv(
        [appointment({ address: "ул. Ленина, 5", comment: 'код "42";' })],
        refs,
      ),
    );
    assert.ok(row.endsWith(';"ул. Ленина, 5";"код ""42"";"'));
  });

  test("записи — по дате и времени начала", () => {
    const csv = appointmentsToCsv(
      [
        appointment({ id: "late", date: "2026-09-25", time_start: "09:00:00" }),
        appointment({ id: "b", date: "2026-09-24", time_start: "12:00:00" }),
        appointment({ id: "a", date: "2026-09-24", time_start: "08:00:00" }),
      ],
      refs,
    );
    assert.deepEqual(
      lines(csv).slice(1).map((l) => cells(l).slice(0, 2).join(" ")),
      ["2026-09-24 08:00", "2026-09-24 12:00", "2026-09-25 09:00"],
    );
  });
});

describe("выгрузка финансов", () => {
  const refs = {
    categories: new Map([["cat", "Топливо"]]),
    accounts: new Map([["acc", "Наличные"]]),
    teams: TEAMS,
    clients: new Map([["c1", "Андрей"]]),
  };
  const row = (over: Partial<TransactionExportRow>) =>
    cells(lines(transactionsToCsv([transaction(over)], refs))[1]);

  test("заголовок — десять колонок по порядку", () => {
    assert.equal(
      lines(transactionsToCsv([], refs))[0],
      "Дата;Время;Тип;Сумма;Категория;Счёт;Команда;Клиент;Заметка;VAT",
    );
  });

  test("доход: имена вместо id, время без секунд, сумма с запятой", () => {
    assert.deepEqual(row({ vat_amount: 197.5, vat_mode: "inclusive" }), [
      "2026-09-24",
      "14:30",
      "Доход",
      "1234,50",
      "Топливо",
      "Наличные",
      "Y&D",
      "Андрей",
      "",
      "197,50",
    ]);
  });

  test("слова типов и знак суммы", () => {
    assert.deepEqual(
      [row({ type: "income" }), row({ type: "expense" }), row({ type: "refund" })].map((r) => [
        r[2],
        r[3],
      ]),
      [
        ["Доход", "1234,50"],
        ["Расход", "-1234,50"],
        ["Возврат", "-1234,50"],
      ],
    );
    // Ноги перевода лежат уже со знаком — печатаются как есть.
    const leg = row({ type: "transfer", amount: -50 });
    assert.deepEqual([leg[2], leg[3]], ["Перевод", "-50,00"]);
    assert.equal(row({ type: "transfer", amount: 50 })[3], "50,00");
  });

  test("число — с запятой, без плавающего хвоста", () => {
    assert.equal(row({ amount: 0.1 + 0.2 })[3], "0,30");
    assert.equal(row({ amount: 1000 })[3], "1000,00");
  });

  test("VAT: «без VAT» руками и пустой налог — пустая ячейка; у расхода минус", () => {
    assert.equal(row({ vat_amount: 50, vat_mode: "none" })[9], "");
    assert.equal(row({ vat_amount: null })[9], "");
    assert.equal(row({ type: "expense", vat_amount: 50, vat_mode: "inclusive" })[9], "-50,00");
  });

  test("нет категории, счёта, клиента, времени — пустые ячейки", () => {
    const r = row({ category_id: null, account_id: null, client_id: null, occurred_time: null });
    assert.deepEqual([r[1], r[4], r[5], r[7]], ["", "", "", ""]);
  });

  test("заметка: «;», кавычки и формула", () => {
    assert.ok(
      lines(transactionsToCsv([transaction({ notes: 'чек "17"; бензин' })], refs))[1].includes(
        ';"чек ""17""; бензин";',
      ),
    );
    assert.equal(row({ notes: "=1+1" })[8], "'=1+1");
  });

  test("операции — от старых к новым", () => {
    const csv = transactionsToCsv(
      [
        transaction({ id: "c", occurred_on: "2026-09-25", occurred_time: "09:00" }),
        transaction({ id: "b", occurred_on: "2026-09-24", occurred_time: "15:00" }),
        transaction({ id: "a", occurred_on: "2026-09-24", occurred_time: "08:00" }),
      ],
      refs,
    );
    assert.deepEqual(
      lines(csv).slice(1).map((l) => cells(l).slice(0, 2).join(" ")),
      ["2026-09-24 08:00", "2026-09-24 15:00", "2026-09-25 09:00"],
    );
  });
});

describe("отбор операций команды", () => {
  const accounts = [
    { id: "acc-1", brigade_id: "team-a" },
    { id: "acc-2", brigade_id: "team-b" },
    { id: "acc-3", brigade_id: "team-a" },
    { id: "acc-4", brigade_id: null },
  ];

  test("строки команды плюс строки без команды на её счетах", () => {
    assert.equal(
      financeTeamFilter("team-a", accounts),
      "team_id.eq.team-a,and(team_id.is.null,account_id.in.(acc-1,acc-3))",
    );
  });

  test("у команды нет счетов — только её строки", () => {
    assert.equal(financeTeamFilter("team-z", accounts), "team_id.eq.team-z");
  });

  test("небезопасный id не вклеивается в фильтр", () => {
    assert.throws(() => financeTeamFilter("a,b", accounts));
    assert.equal(
      financeTeamFilter("team-a", [{ id: "x),or(team_id.not.is.null", brigade_id: "team-a" }]),
      "team_id.eq.team-a",
    );
  });
});

describe("файл", () => {
  test("имена файлов с датой", () => {
    assert.equal(exportFilename("clients", "2026-10-03"), "babun-klienty-2026-10-03.csv");
    assert.equal(exportFilename("appointments", "2026-10-03"), "babun-zapisi-2026-10-03.csv");
    assert.equal(exportFilename("finances", "2026-10-03"), "babun-finansy-2026-10-03.csv");
  });

  test("дата — локальная, с нулями", () => {
    assert.equal(dateStamp(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
  });

  test("заголовок окна «Поделиться» — слово, дата, число строк", () => {
    assert.equal(exportDialogTitle("clients", "2026-10-03", 128), "Клиенты 2026-10-03 (128)");
  });
});

describe("выгрузка — «Оплачено» общей формулой (проверка 03.10)", () => {
  test("аванс без доплаты — не ноль", () => {
    const csv = appointmentsToCsv(
      [appointment({ paid_amount: 0, prepaid_amount: 255, payment_status: "paid", total_amount: 255 })],
      { teams: TEAMS, clients: new Map(), services: new Map() },
    );
    assert.match(csv, /255,00/);
  });
  test("полный возврат — ноль, даже если колонка хранит сумму", () => {
    assert.equal(paidOf(appointment({ paid_amount: 120, payment_status: "refunded" })), 0);
  });
  test("аванс плюс доплата из леджера", () => {
    assert.equal(
      paidOf(appointment({ paid_amount: 0, prepaid_amount: 50, payment_status: "partial", payments: [{ amount: 30 }] as never })),
      80,
    );
  });
});
