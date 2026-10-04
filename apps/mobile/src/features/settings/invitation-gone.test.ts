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
    // Уже принятое — тоже «нет»: сервер отдаёт его с `state: "accepted"`
    // (аудит Кабинета 03.10).
    assert.match(
      screen,
      /const gone =\s*preview\.error instanceof InvitationGoneError \|\| preview\.data\?\.state === "accepted";/,
    );
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

  test("приём по ссылке не уводит владельца в чужой аккаунт (аудит Кабинета 03.10)", () => {
    // Как у «Приглашений»: своё место на устройстве есть — команды встают
    // в ленту, перехода нет (владелец 01.10).
    const raw = readFileSync(join(__dirname, "../../../app/invite/[token].tsx"), "utf8");
    assert.match(raw, /const stay = Boolean\(getActiveTenantId\(\)\);/);
    assert.match(raw, /acceptAndActivateInvitation\(token, preview\.data\?\.role, \{ stay \}\)/);
    const accept = readFileSync(join(__dirname, "invitations.ts"), "utf8");
    assert.match(accept, /if \(!opts\.stay\) await activateAcceptedInvitation\(tenantId, previewRole\);/);
  });
});
