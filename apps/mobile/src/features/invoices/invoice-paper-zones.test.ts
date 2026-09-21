import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { invoiceDictionary } from "./dictionary";
import { PAPER_INVITE, invoicePaperZones } from "./invoice-paper-zones";

const dict = invoiceDictionary("ru");

const FILLED = {
  logoUrl: "https://example.com/logo.png",
  seller: { name: "AC Service", lines: ["Limassol", "VAT: CY123"] },
  client: { name: "Иван Петров", lines: ["+357 111111"] },
  issuedOn: "20 сентября 2026",
  dueOn: "27 сентября 2026",
  notes: "Оплата по договору",
  draft: true,
  dict,
};

const EMPTY = {
  logoUrl: null,
  seller: { name: "AC Service", lines: [] as string[] },
  client: { name: dict.recipientMissing, lines: [] as string[] },
  issuedOn: "20 сентября 2026",
  dueOn: dict.notSet,
  notes: "",
  draft: true,
  dict,
};

const ALL_HANDLERS = { hasLogo: true, hasSeller: true, hasClient: true, hasDate: true, hasNote: true };
const NO_HANDLERS = { hasLogo: false, hasSeller: false, hasClient: false, hasDate: false, hasNote: false };

describe("invoicePaperZones", () => {
  it("бумага без единого коллбэка нигде не нажимается", () => {
    const zones = invoicePaperZones(EMPTY, NO_HANDLERS);
    for (const zone of Object.values(zones)) {
      assert.equal(zone.interactive, false);
      // Без обработчика зона обязана быть просто бумагой — ни одной подсказки.
      assert.equal(zone.invite, null);
    }
  });

  it("заполненный документ печатает значения, а не приглашения", () => {
    const zones = invoicePaperZones(FILLED, ALL_HANDLERS);
    assert.equal(zones.logo.invite, null);
    assert.equal(zones.seller.invite, null);
    assert.equal(zones.client.invite, null);
    assert.equal(zones.dueOn.invite, null);
    assert.equal(zones.note.invite, null);
    // Все зоны интерактивны — коллбэки переданы.
    assert.ok(Object.values(zones).every((zone) => zone.interactive));
  });

  it("пустой документ зовёт тапом ровно словами владельца", () => {
    const zones = invoicePaperZones(EMPTY, ALL_HANDLERS);
    assert.equal(zones.logo.invite, PAPER_INVITE.logo);
    assert.equal(zones.seller.invite, PAPER_INVITE.seller);
    assert.equal(zones.client.invite, PAPER_INVITE.client);
    assert.equal(zones.dueOn.invite, PAPER_INVITE.dueOn);
    assert.equal(zones.note.invite, PAPER_INVITE.note);
  });

  it("дата выставления не нажимается у выставленного документа", () => {
    const issued = invoicePaperZones({ ...FILLED, draft: false }, ALL_HANDLERS);
    assert.equal(issued.issuedOn.interactive, false);
    // «Оплатить до» остаётся живой и у выставленного счёта.
    assert.equal(issued.dueOn.interactive, true);

    const draft = invoicePaperZones({ ...FILLED, draft: true }, ALL_HANDLERS);
    assert.equal(draft.issuedOn.interactive, true);
  });
});
