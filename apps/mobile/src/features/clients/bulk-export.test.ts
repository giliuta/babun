import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Client, ClientTag } from "@babun/shared/local/clients";
import { clientsToCsv } from "./bulk-export";

function client(patch: Partial<Client>): Client {
  return {
    id: "client-1",
    full_name: "Иван Петров",
    phone: "+35799111222",
    phones: [],
    whatsapp_phone: "",
    email: "",
    sms_name: "",
    telegram_username: "",
    instagram_username: "",
    balance: 0,
    discount: 0,
    comment: "",
    tag_ids: [],
    acquisition_source: "unknown",
    referred_by_client_id: null,
    first_contact_date: null,
    address: "",
    city: "Лимасол",
    property_type: "",
    equipment: [],
    locations: [],
    notes: [],
    birthday: "",
    blacklisted: false,
    created_at: "2026-07-20T00:00:00.000Z",
    ...patch,
  };
}

const EMPTY_STATS = {
  visits: 0,
  totalSpent: 0,
  debt: 0,
  lastVisitDate: "",
  lastVisitDays: null,
  nextApt: null,
  nextAptDays: null,
  expectedRevenue: 0,
  lastTeamId: null,
  medianGapDays: null,
  serviceDue: 0,
  unclosedVisits: 0,
} as unknown as import("@babun/shared/local/selectors/client-stats").ClientStats;

describe("mobile client CSV export", () => {
  test("produces an Excel-friendly UTF-8 file with CRLF and escaped values", () => {
    const tags: ClientTag[] = [
      { id: "vip", name: "VIP; важный", color: "#000000" },
    ];
    // Долг берётся из сводки — ТОЙ ЖЕ, что кормит список и карточку.
    // Мёртвое поле `balance` в выгрузку больше не попадает.
    const stats = new Map([["client-1", { ...EMPTY_STATS, debt: 1200 }]]);
    const csv = clientsToCsv(
      [client({ full_name: 'Иван "Иваныч"', tag_ids: ["vip"] })],
      tags,
      stats,
    );

    // Колонка называется МЕТКОЙ: `clients.city` хранит метку, а не город.
    assert.ok(csv.startsWith("\uFEFFИмя;Телефон;Метка;Долг;Теги\r\n"));
    assert.match(csv, /"Иван ""Иваныч"""/);
    assert.match(csv, /€1\u00A0200/);
    assert.match(csv, /"VIP; важный"/);
  });

  test("neutralizes spreadsheet formulas in every client-controlled column", () => {
    const tags: ClientTag[] = [
      { id: "bad", name: "@SUM(A1:A2)", color: "#000000" },
    ];
    const csv = clientsToCsv(
      [
        client({
          full_name: "=HYPERLINK(\"https://bad.example\")",
          phone: "+35799111222",
          city: " -2+3",
          tag_ids: ["bad"],
        }),
      ],
      tags,
    );

    assert.match(csv, /'\+35799111222/);
    assert.match(csv, /"'=HYPERLINK\(""https:\/\/bad\.example""\)"/);
    assert.match(csv, /' -2\+3/);
    assert.match(csv, /'@SUM\(A1:A2\)/);
  });
});
