import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { chipGroups } from "../../components/ui/ScopeChips.groups";
import { tiersForKind } from "../tariffs/tiers";
import { createdCompanyFrom } from "../cabinet/created-company";
import { composeCalendarChips, type ChipSourceCalendar } from "./calendar-chips";
import { toMyAccounts } from "./my-accounts-rows";

// ЛИЧНОЕ И КОМПАНИИ (владелец 11.10): «Личный │ Y&D D&K V&M │ Студия» —
// Личное первым, компании по имени, между аккаунтами черта; порядок человека
// двигает календари только внутри своего аккаунта.

const PERSONAL = "p-1";
const AIRFIX = "c-airfix";
const STUDIO = "c-studio";

const cal = (tenantId: string, tenantName: string, teamId: string, teamName: string): ChipSourceCalendar => ({
  tenantId, tenantName, teamId, teamName, teamColor: null, isActive: false,
});
const names = (chips: { name: string }[]) => chips.map((c) => c.name);

describe("лента: Личное первым, компании группами", () => {
  const myCalendars = [
    cal(STUDIO, "Студия", "t-s", "Студия"),
    cal(PERSONAL, "Яна", "t-p", "Личный"),
    cal(AIRFIX, "AirFix LTD", "t-yd", "Y&D"),
    cal(AIRFIX, "AirFix LTD", "t-dk", "D&K"),
  ];

  test("Личное — первым, даже если по имени оно последнее", () => {
    const chips = composeCalendarChips({
      own: [
        { id: "t-yd", name: "Y&D" },
        { id: "t-dk", name: "D&K" },
      ],
      myCalendars,
      activeTenantId: AIRFIX,
      personalTenantId: PERSONAL,
    });
    // Компании — по имени по-русски: кириллица раньше латиницы.
    assert.deepEqual(names(chips), ["Личный", "Студия", "Y&D", "D&K"]);
    assert.deepEqual(
      chipGroups(chips).map((g) => g.key),
      [PERSONAL, STUDIO, AIRFIX],
    );
  });

  test("порядок человека не уводит календарь в чужую компанию", () => {
    const chips = composeCalendarChips({
      own: [
        { id: "t-yd", name: "Y&D" },
        { id: "t-dk", name: "D&K" },
      ],
      myCalendars,
      activeTenantId: AIRFIX,
      personalTenantId: PERSONAL,
      // Человек поставил D&K первым во всей ленте: внутри AirFix D&K встаёт
      // раньше Y&D, но ни Личное, ни Студию календарь AirFix не обгоняет.
      order: [`${AIRFIX}:t-dk`, `${AIRFIX}:t-yd`, `${STUDIO}:t-s`, `${PERSONAL}:t-p`],
    });
    assert.deepEqual(names(chips), ["Личный", "Студия", "D&K", "Y&D"]);
  });

  test("Личное и компания с одним именем — разные группы", () => {
    const chips = composeCalendarChips({
      own: [{ id: "t-p", name: "Личный" }],
      myCalendars: [cal(PERSONAL, "AirFix LTD", "t-p", "Личный"), cal(AIRFIX, "AirFix LTD", "t-yd", "Y&D")],
      activeTenantId: PERSONAL,
      personalTenantId: PERSONAL,
    });
    assert.deepEqual(chipGroups(chips).length, 2);
  });
});

describe("тарифы по виду аккаунта", () => {
  test("Личное — Соло, компания — Про и Макс, неизвестно — все", () => {
    assert.deepEqual(tiersForKind("personal"), ["solo"]);
    assert.deepEqual(tiersForKind("company"), ["pro", "max"]);
    assert.deepEqual(tiersForKind(null), ["solo", "pro", "max"]);
  });
});

describe("ответы сервера", () => {
  test("create_company: без id — ошибка, пробный — только true", () => {
    assert.deepEqual(createdCompanyFrom({ tenant_id: "x", team_id: "t", trial: true }), {
      tenantId: "x", teamId: "t", trial: true,
    });
    assert.equal(createdCompanyFrom({ tenant_id: "x", team_id: "t", trial: "yes" }).trial, false);
    assert.throws(() => createdCompanyFrom(null));
  });

  test("list_my_accounts: неизвестный вид — компания", () => {
    const rows = toMyAccounts([
      { tenant_id: "a", name: "Я", kind: "personal", role: "owner", joined_at: "2026-10-11" },
      { tenant_id: "b", name: "X", kind: "weird", role: "master", joined_at: "2026-10-11" },
    ]);
    assert.deepEqual(rows.map((r) => r.kind), ["personal", "company"]);
  });
});
