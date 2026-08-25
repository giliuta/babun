import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { InvoiceLedger } from "@babun/shared/local/finance/invoice-ledger";
import type { Receipt } from "@babun/shared/local/finance/receipt";
import {
  collectDocuments,
  filterDocuments,
  type DocumentSources,
} from "./documents";

const PERIOD = { from: "2026-08-01", to: "2026-08-31" };
const TODAY = "2026-08-12";

/** Снимок получателя внутри документа: бумага называет того, кому её выдали,
 *  даже если карточку клиента потом переименовали или удалили. */
const CLIENT_SNAPSHOT: NonNullable<InvoiceLedger["client_snapshot"]> = {
  schema_version: 1,
  client_id: "c-1",
  full_name: "Пётр Иванов",
  phone: null,
  phone_e164: null,
  whatsapp_phone: null,
  email: null,
  address: null,
  city: null,
  primary_address: null,
  archived: false,
  deleted_at: null,
};

function invoice(patch: Partial<InvoiceLedger> = {}): InvoiceLedger {
  return {
    id: "inv-1",
    tenant_id: "t",
    number: "INV-2026-001",
    year: 2026,
    seq: 1,
    issued_on: "2026-08-05",
    due_on: null,
    client_id: "c-1",
    appointment_id: null,
    brigade_id: "team-1",
    subtotal_net: 100,
    vat_percent: 0,
    vat_amount: 0,
    total: 100,
    currency: "EUR",
    language: "ru",
    status: "issued",
    pdf_url: null,
    notes: null,
    created_at: "2026-08-05T10:00:00Z",
    updated_at: "2026-08-05T10:00:00Z",
    created_by: null,
    ...patch,
  };
}

function receipt(patch: Partial<Receipt> = {}): Receipt {
  return {
    id: "rc-1",
    tenant_id: "t",
    number: "RC-2026-001",
    year: 2026,
    seq: 1,
    issued_on: "2026-08-07",
    amount: 60,
    currency: "EUR",
    vat_rate: null,
    vat_amount: null,
    client_id: "c-1",
    appointment_id: null,
    invoice_id: null,
    transaction_id: "tx-1",
    account_id: "acc-1",
    payment_method: "cash",
    status: "issued",
    seller_snapshot: {},
    client_snapshot: { name: "Пётр Иванов" },
    created_at: "2026-08-07T10:00:00Z",
    ...patch,
  };
}

function sources(patch: Partial<DocumentSources> = {}): DocumentSources {
  return {
    invoices: [],
    payments: {},
    receipts: [],
    clientName: () => null,
    receiptTeamId: () => null,
    period: PERIOD,
    teamId: null,
    today: TODAY,
    ...patch,
  };
}

describe("лента документов собирается из инвойсов и чеков", () => {
  test("новые сверху, а одна дата разводится номером", () => {
    const docs = collectDocuments(
      sources({
        invoices: [
          invoice({ id: "a", number: "INV-2026-001", issued_on: "2026-08-05" }),
          invoice({ id: "b", number: "INV-2026-002", issued_on: "2026-08-09" }),
          invoice({ id: "c", number: "INV-2026-003", issued_on: "2026-08-09" }),
        ],
      }),
    );
    assert.deepEqual(
      docs.map((d) => d.id),
      ["c", "b", "a"],
    );
  });

  test("номер одного дня сравнивается числом, а не строкой", () => {
    const docs = collectDocuments(
      sources({
        invoices: [
          invoice({ id: "nine", number: "INV-2026-9", issued_on: "2026-08-09" }),
          invoice({ id: "ten", number: "INV-2026-10", issued_on: "2026-08-09" }),
        ],
      }),
    );
    // Строковое сравнение ставило «9» выше «10» — десятый документ дня
    // проваливался под девятый.
    assert.deepEqual(
      docs.map((d) => d.id),
      ["ten", "nine"],
    );
  });

  test("за границами периода документов нет", () => {
    const docs = collectDocuments(
      sources({
        invoices: [invoice({ id: "old", issued_on: "2026-07-31" })],
        receipts: [receipt({ id: "late", issued_on: "2026-09-01" })],
      }),
    );
    assert.equal(docs.length, 0);
  });

  test("срез команды отбрасывает чужой инвойс, но не общий", () => {
    const docs = collectDocuments(
      sources({
        teamId: "team-1",
        invoices: [
          invoice({ id: "mine", brigade_id: "team-1" }),
          invoice({ id: "alien", brigade_id: "team-2" }),
          // Бумага без команды — общая: спрятать её негде, её просто не будет
          // видно ни в одном срезе.
          invoice({ id: "nobody", brigade_id: null }),
        ],
      }),
    );
    assert.deepEqual(new Set(docs.map((d) => d.id)), new Set(["mine", "nobody"]));
  });

  test("чек без хозяина остаётся в срезе, чужой — уходит", () => {
    const owners: Record<string, string> = { "rc-alien": "team-2" };
    const docs = collectDocuments(
      sources({
        teamId: "team-1",
        receipts: [receipt({ id: "rc-orphan" }), receipt({ id: "rc-alien" })],
        receiptTeamId: (r) => owners[r.id] ?? null,
      }),
    );
    assert.deepEqual(
      docs.map((d) => d.id),
      ["rc-orphan"],
    );
  });
});

describe("состояние документа называет только то, что правда", () => {
  test("оплаченный, ждущий и просроченный инвойс", () => {
    const docs = collectDocuments(
      sources({
        invoices: [
          invoice({ id: "paid", number: "INV-2026-001", status: "paid" }),
          invoice({ id: "open", number: "INV-2026-002", due_on: "2026-08-20" }),
          invoice({ id: "late", number: "INV-2026-003", due_on: "2026-08-11" }),
        ],
      }),
    );
    const state = (id: string) => docs.find((d) => d.id === id);
    assert.equal(state("paid")?.state, "Оплачен");
    assert.equal(state("open")?.state, "К оплате");
    // Просрочка — слово в состоянии, а не цвет: неоплаченный документ не
    // красится (владелец 2026-08-15).
    assert.equal(state("late")?.state, "Просрочен");
  });

  test("частичная оплата всё ещё ждёт денег", () => {
    const docs = collectDocuments(
      sources({
        invoices: [invoice({ total: 100 })],
        payments: {
          "inv-1": [
            {
              id: "p1",
              invoice_id: "inv-1",
              type: "income",
              amount: 40,
              account_id: null,
              payment_method: null,
              occurred_on: "2026-08-06",
              refund_of_id: null,
              notes: null,
              created_at: "2026-08-06T10:00:00Z",
            },
          ],
        },
      }),
    );
    assert.equal(docs[0].state, "К оплате");
  });

  test("аннулированный инвойс не пропадает, а гаснет", () => {
    const docs = collectDocuments(
      sources({ invoices: [invoice({ status: "void", due_on: "2026-08-01" })] }),
    );
    // Просроченный срок не перебивает аннуляцию: документ ничего не ждёт.
    assert.equal(docs[0].state, "Аннулирован");
    assert.equal(docs[0].dead, true);
  });

  test("у выданного чека состояния нет, у аннулированного — есть", () => {
    const docs = collectDocuments(
      sources({
        receipts: [
          receipt({ id: "live", number: "RC-2026-002" }),
          receipt({ id: "dead", number: "RC-2026-001", status: "void" }),
        ],
      }),
    );
    assert.equal(docs.find((d) => d.id === "live")?.state, null);
    // То же слово, что у инвойса: «Погашен» читался бы как «оплачен».
    assert.equal(docs.find((d) => d.id === "dead")?.state, "Аннулирован");
    assert.equal(docs.find((d) => d.id === "dead")?.dead, true);
  });

  test("имя клиента берётся со снимка документа, живая карточка — фолбэк", () => {
    const docs = collectDocuments(
      sources({
        clientName: (id) => (id === "c-1" ? "Живой Клиент" : null),
        invoices: [
          invoice({ id: "snap", client_snapshot: CLIENT_SNAPSHOT }),
          invoice({ id: "live", number: "INV-2026-002" }),
          invoice({ id: "none", number: "INV-2026-003", client_id: null }),
        ],
      }),
    );
    const name = (id: string) => docs.find((d) => d.id === id)?.clientName;
    assert.equal(name("snap"), "Пётр Иванов");
    assert.equal(name("live"), "Живой Клиент");
    assert.equal(name("none"), "Без клиента");
  });
});

describe("сегмент и поиск режут уже собранный список", () => {
  const docs = collectDocuments(
    sources({
      clientName: () => "Анна Петрова",
      invoices: [invoice({ total: 480 })],
      receipts: [receipt()],
    }),
  );

  test("сегмент оставляет один вид", () => {
    assert.deepEqual(
      filterDocuments(docs, "invoice", "").map((d) => d.kind),
      ["invoice"],
    );
    assert.deepEqual(
      filterDocuments(docs, "receipt", "").map((d) => d.kind),
      ["receipt"],
    );
  });

  test("ищем по номеру, клиенту и сумме ВНУТРИ вида", () => {
    // Поиск живёт под сегментом, а не над ним: «2026-001» есть и у инвойса, и
    // у чека, и каждый находится в своей вкладке — иначе счёт всплывал бы в
    // ленте чеков.
    assert.equal(filterDocuments(docs, "invoice", "2026-001").length, 1);
    assert.equal(filterDocuments(docs, "receipt", "2026-001").length, 1);
    assert.equal(filterDocuments(docs, "receipt", "rc-2026").length, 1);
    assert.equal(filterDocuments(docs, "invoice", "rc-2026").length, 0);
    assert.equal(filterDocuments(docs, "receipt", "пётр").length, 1);
    assert.equal(filterDocuments(docs, "invoice", "пётр").length, 0);
    assert.equal(filterDocuments(docs, "invoice", "480").length, 1);
    assert.equal(filterDocuments(docs, "invoice", "нет такого").length, 0);
  });

  test("сумма находится и в напечатанной форме", () => {
    const priced = collectDocuments(
      sources({
        invoices: [
          invoice({ id: "frac", number: "INV-2026-001", total: 480.5 }),
          invoice({ id: "big", number: "INV-2026-002", total: 1200 }),
        ],
      }),
    );
    // На строке стоит «€480,50» — человек набирает то, что видит.
    assert.equal(filterDocuments(priced, "invoice", "480,50").length, 1);
    assert.equal(filterDocuments(priced, "invoice", "480.50").length, 1);
    assert.equal(filterDocuments(priced, "invoice", "480.5").length, 1);
    // Разрядный пробел («1 200», в том числе неразрывный) не мешает поиску.
    assert.equal(filterDocuments(priced, "invoice", "1 200").length, 1);
    assert.equal(filterDocuments(priced, "invoice", "1\u00A0200").length, 1);
  });
});
