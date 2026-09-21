import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  canSaveCompany,
  companyDetail,
  companyFilled,
  defaultHeir,
  formatIban,
  isCompanyDraftDirty,
  normalizeCompanyDraft,
} from "./company-rules";
import type { CompanyDraft } from "./queries";

const blank: CompanyDraft = {
  name: "",
  color: null,
  icon: null,
  logo_url: null,
  legal_name: null,
  business_address: null,
  vat_number: null,
  reg_number: null,
  iban: null,
  bank_name: null,
  contact_phone: null,
  contact_email: null,
};

const row = {
  is_default: false,
  archived_at: null as string | null,
  legal_name: null as string | null,
  vat_number: null as string | null,
  business_address: null as string | null,
};

describe("companyDetail", () => {
  test("prints legal name and VAT, default first", () => {
    assert.equal(
      companyDetail({ ...row, is_default: true, legal_name: "Airfix LTD", vat_number: "60184450X" }),
      "Основные · Airfix LTD · VAT 60184450X",
    );
  });

  test("falls back to the first address line, then to the empty notice", () => {
    assert.equal(
      companyDetail({ ...row, business_address: "Charalampou Mouskou, 20\n8010, Paphos" }),
      "Charalampou Mouskou, 20",
    );
    assert.equal(companyDetail(row), "Реквизиты не заполнены");
  });

  test("a hidden set says so", () => {
    assert.equal(
      companyDetail({ ...row, archived_at: "2026-09-22", legal_name: "X" }),
      "X · скрыты",
    );
  });
});

describe("companyFilled", () => {
  test("an internal name alone is not requisites", () => {
    assert.equal(companyFilled(row), false);
    assert.equal(companyFilled({ ...row, vat_number: "60184450X" }), true);
    assert.equal(companyFilled({ ...row, business_address: "\n  \n" }), false);
  });
});

describe("defaultHeir", () => {
  test("hands the default to the first visible other set", () => {
    const list = [
      { id: "a", archived_at: null },
      { id: "b", archived_at: "2026-09-22" },
      { id: "c", archived_at: null },
    ];
    assert.equal(defaultHeir(list, "a"), "c");
  });

  test("nobody to hand over to", () => {
    assert.equal(defaultHeir([{ id: "a", archived_at: null }], "a"), null);
  });
});

describe("normalizeCompanyDraft", () => {
  test("IBAN is printed upper-case in groups of four", () => {
    assert.equal(formatIban("lt88 325004855 0100925"), "LT88 3250 0485 5010 0925");
  });

  test("cleans numbers, e-mail and address lines", () => {
    const out = normalizeCompanyDraft({
      ...blank,
      name: "  AirFix ",
      vat_number: " 60184450x ",
      reg_number: "he425701",
      contact_email: " AirFix.CY@Gmail.com ",
      business_address: "Charalampou Mouskou, 20\n\n  ABC BUSINESS CENTRE,  \n8010, Paphos\n",
      bank_name: "   ",
    });
    assert.equal(out.name, "AirFix");
    assert.equal(out.vat_number, "60184450X");
    assert.equal(out.reg_number, "HE425701");
    assert.equal(out.contact_email, "airfix.cy@gmail.com");
    assert.equal(out.business_address, "Charalampou Mouskou, 20\nABC BUSINESS CENTRE,\n8010, Paphos");
    assert.equal(out.bank_name, null);
  });

  test("a set without a name takes its legal name", () => {
    assert.equal(normalizeCompanyDraft({ ...blank, legal_name: "Airfix LTD" }).name, "Airfix LTD");
    assert.equal(canSaveCompany({ ...blank, legal_name: "Airfix LTD" }), true);
    assert.equal(canSaveCompany(blank), false);
  });
});

describe("isCompanyDraftDirty", () => {
  test("whitespace alone is not an edit, a real value is", () => {
    const initial = { ...blank, name: "AirFix" };
    assert.equal(isCompanyDraftDirty(initial, { ...initial, name: "AirFix " }), false);
    assert.equal(isCompanyDraftDirty(initial, { ...initial, vat_number: "1" }), true);
  });
});
