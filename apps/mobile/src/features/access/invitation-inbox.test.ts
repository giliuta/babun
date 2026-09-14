import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { invitationCardView, isInvitationGone, parseMyInvitations } from "./invitation-inbox";

const ROW = {
  id: "inv-1",
  tenant_id: "11365a87-bef9-4f6c-a030-b15083fe646b",
  company: "Giliuta",
  inviter: "giluta.art",
  role: "master",
  calendar: { id: "team-mrnz51gs-sd9bo", name: "Команда 1", color: "#0A5C57" },
  expires_at: "2026-09-21T20:00:00Z",
  created_at: "2026-09-14T20:00:00Z",
};

describe("parseMyInvitations", () => {
  test("пустой список — норма", () => {
    assert.deepEqual(parseMyInvitations([]), []);
  });

  test("приглашение со всеми полями", () => {
    const [invitation] = parseMyInvitations([ROW]);
    assert.equal(invitation.tenantId, ROW.tenant_id);
    assert.equal(invitation.role, "master");
    assert.deepEqual(invitation.calendar, { id: "team-mrnz51gs-sd9bo", name: "Команда 1", color: "#0A5C57" });
  });

  test("приглашение без календаря и без цвета", () => {
    const [noCalendar] = parseMyInvitations([{ ...ROW, calendar: null }]);
    assert.equal(noCalendar.calendar, null);
    const [noColor] = parseMyInvitations([{ ...ROW, calendar: { id: "t", name: "К", color: null } }]);
    assert.equal(noColor.calendar?.color, null);
  });

  test("порядок сервера сохраняется", () => {
    const list = parseMyInvitations([{ ...ROW, id: "new" }, { ...ROW, id: "old" }]);
    assert.deepEqual(list.map((i) => i.id), ["new", "old"]);
  });

  test("мусор — ошибка сервера, а не пустота", () => {
    assert.throws(() => parseMyInvitations(null));
    assert.throws(() => parseMyInvitations({}));
    assert.throws(() => parseMyInvitations([{ ...ROW, role: "owner" }]));
    assert.throws(() => parseMyInvitations([{ ...ROW, company: 1 }]));
    assert.throws(() => parseMyInvitations([{ ...ROW, calendar: { id: "t" } }]));
  });
});

describe("invitationCardView", () => {
  test("компания, календарь и кто пригласил", () => {
    const [invitation] = parseMyInvitations([ROW]);
    assert.deepEqual(invitationCardView(invitation), {
      companyName: "Giliuta",
      calendarName: "Команда 1",
      invitedBy: "giluta.art",
    });
  });

  test("пустое имя пригласившего не рисуется", () => {
    const [invitation] = parseMyInvitations([{ ...ROW, inviter: "  ", calendar: null }]);
    assert.deepEqual(invitationCardView(invitation), {
      companyName: "Giliuta",
      calendarName: null,
      invitedBy: null,
    });
  });
});

describe("isInvitationGone", () => {
  test("not found по подсказке или тексту — приглашения уже нет", () => {
    assert.equal(isInvitationGone({ hint: "invite:not_found", message: "x" }), true);
    assert.equal(isInvitationGone({ message: "invitation not found" }), true);
  });

  test("другие отказы — настоящая ошибка", () => {
    assert.equal(isInvitationGone({ message: "invitation expired" }), false);
    assert.equal(isInvitationGone(null), false);
  });
});
