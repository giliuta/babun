import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  expiryDateRu,
  invitationLink,
  renderInvitationEmail,
  type InvitationEmailPayload,
} from "./render.ts";

const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz012345-_x";

const base: InvitationEmailPayload = {
  email: "master@example.com",
  token: TOKEN,
  company: "Giliuta",
  inviter: "Артём",
  role: "master",
  calendar: "Команда 1",
  expires_at: "2026-09-21T18:00:00Z",
};

describe("invitation email", () => {
  test("the link is https on the site, not the app scheme", () => {
    assert.equal(invitationLink("https://babun.app/", TOKEN), `https://babun.app/invite/${TOKEN}`);
    const mail = renderInvitationEmail(base, "https://babun.app");
    assert.match(mail.text, new RegExp(`https://babun\\.app/invite/${TOKEN}`));
    assert.doesNotMatch(mail.text + mail.html, /babun:\/\//);
  });

  test("a malformed token never reaches a link", () => {
    assert.throws(() => invitationLink("https://babun.app", "short"));
    assert.throws(() => invitationLink("https://babun.app", `${TOKEN}"><script>`));
  });

  test("names the company, who invited, the role label and the calendar", () => {
    const mail = renderInvitationEmail(base, "https://babun.app");
    assert.equal(mail.subject, "Вас пригласили в «Giliuta»");
    assert.match(mail.text, /Артём приглашает вас в «Giliuta» в Babun\./);
    assert.match(mail.text, /Роль: Бригадир \/ мастер\./);
    assert.match(mail.text, /Календарь: Команда 1\./);
    assert.match(mail.text, /действует до 21 сентября/);
  });

  test("without inviter or calendar the sentences stay whole", () => {
    const mail = renderInvitationEmail(
      { ...base, inviter: null, calendar: null, role: "dispatcher" },
      "https://babun.app",
    );
    assert.match(mail.text, /Вас приглашают в «Giliuta» в Babun\./);
    assert.match(mail.text, /Роль: Диспетчер\./);
    assert.doesNotMatch(mail.text, /Календарь:/);
  });

  test("company names cannot break the subject or inject markup", () => {
    const mail = renderInvitationEmail(
      { ...base, company: "Evil\nBcc: x@y.z <b>", inviter: "<img src=x onerror=1>" },
      "https://babun.app",
    );
    assert.doesNotMatch(mail.subject, /[\r\n]/);
    assert.doesNotMatch(mail.html, /<img|<b>/);
    assert.match(mail.html, /&lt;img src=x onerror=1&gt;/);
  });

  test("an unreadable expiry date drops only the date sentence", () => {
    assert.equal(expiryDateRu("not a date"), "");
    const mail = renderInvitationEmail({ ...base, expires_at: "nope" }, "https://babun.app");
    assert.doesNotMatch(mail.text, /действует до/);
    assert.match(mail.text, /просто не отвечайте/);
  });
});
