import { describe, expect, test } from "bun:test";

import { invoiceInTeamScope } from "./invoice-ledger";

// Две витрины уже спорили об одних деньгах: список документов пропускал
// инвойс без команды, а плитка «Документы» отсекала его строгим сравнением.
// Работа при этом вычёркивалась из «Долгов» как выставленная — счёт на €250
// пропадал из ОБЕИХ цифр и оставался виден только в списке.

describe("invoiceInTeamScope", () => {
  test("документ БЕЗ команды — общий: виден в любом срезе", () => {
    expect(invoiceInTeamScope({ brigade_id: null }, "team-1")).toBe(true);
  });

  test("свою команду видно", () => {
    expect(invoiceInTeamScope({ brigade_id: "team-1" }, "team-1")).toBe(true);
  });

  test("чужую команду не видно", () => {
    expect(invoiceInTeamScope({ brigade_id: "team-2" }, "team-1")).toBe(false);
  });

  test("среза нет — видно всё", () => {
    expect(invoiceInTeamScope({ brigade_id: "team-2" }, null)).toBe(true);
    expect(invoiceInTeamScope({ brigade_id: null }, undefined)).toBe(true);
  });
});
