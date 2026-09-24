import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ClientRequisites } from "./clients";
import {
  LEGACY_REQUISITES_ID,
  clientRequisitesOf,
  invoiceNeedsRequisitesChoice,
  invoiceRequisites,
  makeDefaultRequisites,
  normalizeClientRequisites,
  orderedRequisites,
  removeRequisites,
  requisitesMirror,
  requisitesPatch,
  resolveInvoiceRequisitesId,
  upsertRequisites,
} from "./client-requisites";

// Правила обязаны совпадать с серверной `normalize_client_requisites`
// (миграция 20260922100000): экран показывает их ДО ответа сервера.

function ids() {
  let n = 0;
  return () => `new-${++n}`;
}

const set = (id: string, patch: Partial<ClientRequisites> = {}): ClientRequisites => ({
  id,
  legal_name: `${id} Ltd`,
  vat_number: null,
  reg_number: null,
  billing_address: null,
  is_default: false,
  ...patch,
});

describe("normalizeClientRequisites — те же правила, что у сервера", () => {
  test("пустой набор выбрасывается, края срезаются, VAT и рег. — заглавными", () => {
    const out = normalizeClientRequisites(
      [
        { id: "a", legal_name: "   ", vat_number: "", reg_number: null, billing_address: " " },
        { id: "b", legal_name: "  Test Ltd ", vat_number: " cy123 ", reg_number: "he 1" },
      ],
      ids(),
    );
    assert.deepEqual(out, [
      {
        id: "b",
        legal_name: "Test Ltd",
        vat_number: "CY123",
        reg_number: "HE 1",
        billing_address: null,
        is_default: true,
      },
    ]);
  });

  test("нет основного — основным становится первый", () => {
    const out = normalizeClientRequisites([set("a"), set("b")], ids());
    assert.deepEqual(out.map((s) => s.is_default), [true, false]);
  });

  test("два основных — остаётся первый из отмеченных", () => {
    const out = normalizeClientRequisites(
      [set("a"), set("b", { is_default: true }), set("c", { is_default: true })],
      ids(),
    );
    assert.deepEqual(out.map((s) => s.is_default), [false, true, false]);
  });

  test("нет id или повтор — выдаётся новый", () => {
    const out = normalizeClientRequisites(
      [{ legal_name: "A" }, set("x"), set("x", { legal_name: "Twin" })],
      ids(),
    );
    assert.deepEqual(out.map((s) => s.id), ["new-1", "x", "new-2"]);
  });

  test("лишние ключи срезаются", () => {
    const dirty = { ...set("a"), junk: 1 } as ClientRequisites;
    const [out] = normalizeClientRequisites([dirty], ids());
    assert.equal("junk" in out, false);
  });
});

describe("clientRequisitesOf — строка старше миграции", () => {
  test("наборов нет, колонки заполнены — один основной набор из колонок", () => {
    const sets = clientRequisitesOf({ legal_name: "Old Ltd", vat_number: "CY1", requisites: [] });
    assert.equal(sets.length, 1);
    assert.equal(sets[0].id, LEGACY_REQUISITES_ID);
    assert.equal(sets[0].is_default, true);
  });

  test("пустая строка — ни одного набора", () => {
    assert.deepEqual(clientRequisitesOf({ legal_name: " ", requisites: undefined }), []);
  });

  test("наборы есть — берутся они, колонки не смешиваются", () => {
    const sets = [set("a", { is_default: true }), set("b")];
    assert.equal(clientRequisitesOf({ legal_name: "Mirror", requisites: sets }), sets);
  });
});

describe("писатель: добавить, править, удалить, сделать основным", () => {
  test("первый набор — основной; второй — нет", () => {
    const first = upsertRequisites([], { legal_name: "A" }, ids());
    assert.equal(first[0].is_default, true);
    const both = upsertRequisites(first, { legal_name: "B" }, ids());
    assert.deepEqual(both.map((s) => [s.legal_name, s.is_default]), [["A", true], ["B", false]]);
  });

  test("правка по id меняет поля и не трогает основной", () => {
    const all = [set("a", { is_default: true }), set("b")];
    const out = upsertRequisites(all, { id: "b", vat_number: "cy9" }, ids());
    assert.equal(out[1].vat_number, "CY9");
    assert.equal(out[1].legal_name, "b Ltd");
    assert.equal(out[0].is_default, true);
  });

  test("правка набора в пустоту удаляет его", () => {
    const all = [set("a", { is_default: true }), set("b")];
    const out = upsertRequisites(all, { id: "b", legal_name: "" }, ids());
    assert.deepEqual(out.map((s) => s.id), ["a"]);
  });

  test("удалили основной — основным стал первый оставшийся", () => {
    const all = [set("a", { is_default: true }), set("b"), set("c")];
    const out = removeRequisites(all, "a", ids());
    assert.deepEqual(out.map((s) => [s.id, s.is_default]), [["b", true], ["c", false]]);
  });

  test("сделать основным — ровно один основной", () => {
    const all = [set("a", { is_default: true }), set("b")];
    const out = makeDefaultRequisites(all, "b", ids());
    assert.deepEqual(out.map((s) => s.is_default), [false, true]);
    assert.deepEqual(makeDefaultRequisites(all, "ghost", ids()), all);
  });

  test("патч везёт массив и зеркало основного", () => {
    const all = [set("a"), set("b", { is_default: true, vat_number: "CY2" })];
    const patch = requisitesPatch(all);
    assert.equal(patch.requisites?.length, 2);
    assert.equal(patch.legal_name, "b Ltd");
    assert.equal(patch.vat_number, "CY2");
    assert.deepEqual(requisitesMirror([]), {
      legal_name: null,
      vat_number: null,
      reg_number: null,
      billing_address: null,
    });
  });

  test("основной — первым в списке", () => {
    const out = orderedRequisites([set("a"), set("b", { is_default: true })]);
    assert.deepEqual(out.map((s) => s.id), ["b", "a"]);
  });
});

describe("выбор набора в инвойсе", () => {
  const all = [set("main", { is_default: true }), set("second")];

  test("строка выбора — только когда наборов больше одного", () => {
    assert.equal(invoiceNeedsRequisitesChoice([]), false);
    assert.equal(invoiceNeedsRequisitesChoice([all[0]]), false);
    assert.equal(invoiceNeedsRequisitesChoice(all), true);
  });

  test("выбран неосновной — его id; основной или пропавший — null", () => {
    assert.equal(resolveInvoiceRequisitesId(all, "second"), "second");
    assert.equal(resolveInvoiceRequisitesId(all, "main"), null);
    assert.equal(resolveInvoiceRequisitesId(all, "gone"), null);
    assert.equal(resolveInvoiceRequisitesId(all, null), null);
  });

  test("печатается выбранный, иначе основной", () => {
    assert.equal(invoiceRequisites(all, "second")?.id, "second");
    assert.equal(invoiceRequisites(all, "gone")?.id, "main");
    assert.equal(invoiceRequisites([], "second"), null);
  });

  test("набор другого клиента после смены клиента — основной нового", () => {
    const other = [set("x", { is_default: true }), set("y")];
    assert.equal(resolveInvoiceRequisitesId(other, "second"), null);
    assert.equal(invoiceRequisites(other, "second")?.id, "x");
  });
});
