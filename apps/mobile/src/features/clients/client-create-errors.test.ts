import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { friendlyCreateError, isPhoneTakenError } from "./client-create-errors";

// Разбор ошибок создания клиента. Обе функции родились из боевого бага:
// на экране висела сырая ошибка Postgres «createClient: function
// public.normalize_client_tag_ids(uuid, uuid[]) does not exist», а
// уникальность телефона должна опираться на индекс в БД, а не только на
// предварительную проверку.

describe("isPhoneTakenError", () => {
  test("ловит код 23505", () => {
    assert.equal(isPhoneTakenError({ code: "23505" }), true);
  });

  test("ловит имя частичного индекса в тексте", () => {
    // Обёртки (офлайн-очередь, PostgREST) теряют по дороге поле code,
    // оставляя только текст — поэтому имя индекса тоже сигнал.
    assert.equal(
      isPhoneTakenError({
        message:
          'duplicate key value violates unique constraint "clients_tenant_phone_e164_idx"',
      }),
      true,
    );
  });

  test("ловит duplicate key вместе с phone_e164 в details", () => {
    assert.equal(
      isPhoneTakenError({
        message: "duplicate key value violates unique constraint",
        details: "Key (tenant_id, phone_e164)=(…, +35799452118) already exists.",
      }),
      true,
    );
  });

  test("НЕ путает с чужим нарушением уникальности", () => {
    // Дубль по другому индексу не должен показывать «телефон занят» —
    // иначе пользователь пойдёт искать несуществующего клиента.
    assert.equal(
      isPhoneTakenError({
        message:
          'duplicate key value violates unique constraint "appointments_pkey"',
      }),
      false,
    );
  });

  test("не падает на не-объектах", () => {
    assert.equal(isPhoneTakenError(null), false);
    assert.equal(isPhoneTakenError(undefined), false);
    assert.equal(isPhoneTakenError("boom"), false);
  });
});

describe("friendlyCreateError", () => {
  test("прячет сырую ошибку Postgres — ровно тот текст, что увидел владелец", () => {
    const raw =
      "createClient: function public.normalize_client_tag_ids(uuid, uuid[]) does not exist";
    const shown = friendlyCreateError(new Error(raw));
    assert.equal(shown, "Не удалось сохранить клиента. Попробуйте ещё раз.");
    assert.ok(!shown.includes("normalize_client_tag_ids"));
    assert.ok(!shown.includes("public."));
  });

  test("прячет технический текст PostgREST", () => {
    assert.equal(
      friendlyCreateError(new Error("PGRST202: schema cache reload required")),
      "Не удалось сохранить клиента. Попробуйте ещё раз.",
    );
  });

  test("наши русские сообщения показывает как есть", () => {
    // Квоты и лимиты писали мы и адресовали пользователю — их глушить нельзя.
    const ours = "Достигнут лимит клиентов на тарифе. Обновите план.";
    assert.equal(friendlyCreateError(new Error(ours)), ours);
  });

  test("работает не только с Error", () => {
    assert.equal(
      friendlyCreateError("plain string failure"),
      "Не удалось сохранить клиента. Попробуйте ещё раз.",
    );
  });
});
