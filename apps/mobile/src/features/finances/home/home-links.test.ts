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

  test("appointment carries its day, team and the way back", () => {
    assert.equal(
      appointmentHref(
        { id: "a1", date: "2026-10-03", team_id: "t1" },
        { view: "accounts", account: "acc1", team: "t1" },
      ),
      "/(dashboard)?appointmentId=a1&date=2026-10-03&teamId=t1&from=finances%3Aaccounts%3Aacc1%40t1",
    );
  });

  test("appointment without a team and the root view", () => {
    assert.equal(
      appointmentHref({ id: "a1", date: "2026-10-03", team_id: null }, { view: "all", account: null, team: null }),
      "/(dashboard)?appointmentId=a1&date=2026-10-03&from=finances",
    );
  });
});
