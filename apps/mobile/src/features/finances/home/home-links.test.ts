import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { NO_TEAM } from "../accounts-sections";
import { appointmentHref, financeSettingsHref, newInvoiceHref } from "./home-links";

describe("home links", () => {
  test("settings open on the chip's team; «Без команды» carries none", () => {
    assert.equal(financeSettingsHref("t 1"), "/finances/settings?team=t%201");
    assert.equal(financeSettingsHref(NO_TEAM), "/finances/settings");
    assert.equal(financeSettingsHref(null), "/finances/settings");
  });

  test("new invoice goes to the chip's team", () => {
    assert.equal(newInvoiceHref("t1"), "/invoices/new?teamId=t1");
    assert.equal(newInvoiceHref(NO_TEAM), "/invoices/new");
    assert.equal(newInvoiceHref(null), "/invoices/new");
  });

  test("appointment opens as a page over the money tab", () => {
    assert.equal(appointmentHref({ id: "a1" }), "/book?appointmentId=a1");
  });
});
