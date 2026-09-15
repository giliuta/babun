import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import { isGoneInvitationMessage } from "./invitation-flow";

// ОТОЗВАННОЕ ПРИГЛАШЕНИЕ НЕ ДОЛЖНО ОТКРЫВАТЬСЯ ВЕЧНО (владелец 15.09: «вечная
// хуета открывается… почему кнопка не внизу»). Экран тянет react-native и под
// раннером не поднимается, поэтому его устройство проверяется по исходнику.

describe("ответ сервера «приглашения нет»", () => {
  test("не найдено, испорченная ссылка, уже принято — приглашения нет", () => {
    assert.equal(isGoneInvitationMessage("invitation not found"), true);
    assert.equal(isGoneInvitationMessage("invalid token"), true);
    assert.equal(isGoneInvitationMessage("invitation already accepted"), true);
    assert.equal(isGoneInvitationMessage("Некорректная ссылка"), true);
  });

  test("обрыв связи и чужой email — не повод забывать ссылку", () => {
    assert.equal(isGoneInvitationMessage("Network request failed"), false);
    assert.equal(isGoneInvitationMessage("AbortError: Aborted"), false);
    assert.equal(
      isGoneInvitationMessage("invitation email does not match the signed-in account"),
      false,
    );
  });
});

const screen = readFileSync(join(__dirname, "../../../app/invite/[token].tsx"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
  .replace(/\s+/g, " ");

describe("экран приглашения", () => {
  test("ссылка забывается, когда приглашения нет или срок истёк", () => {
    assert.match(screen, /const gone = preview\.error instanceof InvitationGoneError;/);
    assert.match(
      screen,
      /if \(token && \(gone \|\| expired\)\) void clearPendingInvitationToken\(token\);/,
    );
  });

  test("ушёл с экрана — ссылка забыта", () => {
    assert.match(screen, /const goBack = \(\) => \{ if \(token\) void clearPendingInvitationToken\(token\);/);
  });

  test("кнопки — только в футере внизу, в карточке сообщения кнопки нет", () => {
    assert.match(
      screen,
      /\{footer \? \( <View style=\{\{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10, gap: 8 \}\}> \{footer\} <\/View> \) : null\}/,
    );
    const card = screen.slice(screen.indexOf("function MessageCard"));
    assert.doesNotMatch(card, /Button/);
  });

  test("на «приглашения нет» — «Готово», а не бесполезное «Повторить»", () => {
    assert.match(
      screen,
      /\} else if \(gone\) \{ content = \( <MessageCard title="Приглашения больше нет"[^)]*\/> \); footer = <GradientButton label="Готово" onPress=\{goBack\} \/>;/,
    );
  });
});
