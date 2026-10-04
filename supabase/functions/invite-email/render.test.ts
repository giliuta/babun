import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  EMAIL_LOCALES,
  emailLocale,
  invitationLink,
  renderInvitationEmail,
  type InvitationEmailPayload,
} from "./render.ts";

const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz012345-_x";

const base: InvitationEmailPayload = {
  email: "partner@example.com",
  token: TOKEN,
  account: "Giliuta",
  inviter: "Артём",
  teams: ["Команда 1", "Личный"],
  expires_at: "2026-10-11T18:00:00Z",
};

describe("письмо-приглашение партнёру", () => {
  test("ссылка — https на сайт, не схема приложения", () => {
    assert.equal(invitationLink("https://babun.app/", TOKEN), `https://babun.app/invite/${TOKEN}`);
    const mail = renderInvitationEmail(base, "https://babun.app");
    assert.match(mail.text, new RegExp(`https://babun\\.app/invite/${TOKEN}`));
    assert.doesNotMatch(mail.text + mail.html, /babun:\/\//);
  });

  test("кто зовёт и в какие команды — словами партнёра, не «сотрудник»", () => {
    const mail = renderInvitationEmail(base, "https://babun.app");
    assert.equal(mail.subject, "Артём приглашает вас в Babun");
    assert.match(mail.text, /Команды: Команда 1, Личный/);
    assert.doesNotMatch(mail.text + mail.html, /сотрудник|Диспетчер|Бригадир|компани/i);
  });

  test("семь языков, неизвестный — русский", () => {
    for (const locale of EMAIL_LOCALES) {
      const mail = renderInvitationEmail(base, "https://babun.app", locale);
      assert.ok(mail.subject.includes("Артём"), locale);
      assert.match(mail.html, new RegExp(`<html lang="${locale}">`));
    }
    assert.equal(emailLocale("fr"), "ru");
    assert.equal(emailLocale(undefined), "ru");
    assert.match(renderInvitationEmail(base, "https://babun.app", "en").subject, /invites you/);
  });

  test("заголовок одной строкой, html экранирован, плохой токен отклонён", () => {
    const mail = renderInvitationEmail(
      { ...base, inviter: "Иван\r\nBcc: x@y.z", teams: ["<script>"] },
      "https://babun.app",
    );
    assert.doesNotMatch(mail.subject, /[\r\n]/);
    assert.doesNotMatch(mail.html, /<script>/);
    assert.throws(() => invitationLink("https://babun.app", "short"));
  });

  test("без имени зовущего — имя аккаунта", () => {
    const mail = renderInvitationEmail({ ...base, inviter: null }, "https://babun.app");
    assert.equal(mail.subject, "Giliuta приглашает вас в Babun");
  });
});
