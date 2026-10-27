import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { deleteTransferAlert, minusWarning, minusAfterSpend } from "../account-alerts";

// ОТМЕНА ПЕРЕВОДА НЕ ЗАПРЕЩАЕТСЯ. Минус на счёте разрешён всем: расход уводит
// в минус без отказа, а отмена перевода для получателя — тот же расход. Сервер
// (`delete_account_transfer`) раньше отказывал, если на получателе меньше суммы
// перевода, — счёт, бывший в минусе, не проходил никогда. Теперь отказа нет,
// а уход в минус приложение называет до подтверждения.
const here = path.dirname(fileURLToPath(import.meta.url));

describe("отмена перевода: миграция", () => {
  // До наката файл лежит в `supabase/parked/`, после — в `migrations/`.
  const file = "20261027231700_transfer_undo_negative_destination.sql";
  const repo = path.resolve(here, "../../../../../..");
  const found = ["supabase/migrations", "supabase/parked"]
    .map((dir) => path.join(repo, dir, file))
    .find((p) => existsSync(p));

  test("снимает отказ по остатку получателя по якорю в живом теле", () => {
    assert.ok(found, `нет ${file}`);
    const sql = readFileSync(found, "utf8");
    assert.match(sql, /execute replace\(definition, old_check, ''\);/);
    assert.match(sql, /якорь проверки остатка не найден/);
    // Сторож внутри миграции: после правки отказа в теле быть не должно.
    assert.match(sql, /отказ по остатку остался/);
    assert.match(sql, /has_function_privilege\('anon', 'public\.delete_account_transfer\(uuid\)', 'execute'\)/);
  });
});

describe("отмена перевода: слова о минусе", () => {
  test("получатель уйдёт в минус — вопрос называет счёт и остаток после", () => {
    const minus = minusAfterSpend({ name: "Test QA", balance: 209.75, balance_known: true }, 260);
    assert.deepEqual(minus, { name: "Test QA", after: -50.25 });
    const alert = deleteTransferAlert(minus);
    assert.ok(alert.message.endsWith(minusWarning({ name: "Test QA", after: -50.25 })));
    assert.equal(alert.confirm, "Удалить перевод");
  });

  test("сумма ноги со знаком минус — та же сумма отмены", () => {
    assert.deepEqual(
      minusAfterSpend({ name: "Карта", balance: 10, balance_known: true }, -30),
      { name: "Карта", after: -20 },
    );
  });

  test("минуса нет или остаток неизвестен — вопрос прежний, без догадок", () => {
    assert.equal(minusAfterSpend({ name: "Cash", balance: 260, balance_known: true }, 260), null);
    assert.equal(minusAfterSpend({ name: "Cash", balance: 0, balance_known: false }, 260), null);
    assert.equal(minusAfterSpend(undefined, 260), null);
    assert.equal(deleteTransferAlert(null).message, deleteTransferAlert().message);
  });

  test("обе двери отмены — свайп ленты и витрина операции — считают минус", () => {
    const rows = readFileSync(path.resolve(here, "../home/use-row-actions.ts"), "utf8");
    assert.match(rows, /deleteTransferAlert\(undoMinus\(tx\)\)/);
    const popup = readFileSync(path.resolve(here, "../TransactionPopup.tsx"), "utf8");
    assert.match(popup, /deleteTransferAlert\(minusAfterSpend\(/);
  });
});

describe("отмена перевода — одно слово (F-48)", () => {
  test("кнопка, вопрос и подтверждение говорят «Удалить перевод»", () => {
    const popup = readFileSync(path.resolve(here, "../TransactionPopup.tsx"), "utf8");
    assert.match(popup, /tx\.type === "transfer" \? "Удалить перевод" : "Удалить операцию"/);
    assert.doesNotMatch(popup, /"Отменить перевод"/);
    assert.equal(deleteTransferAlert().title, "Удалить перевод?");
    assert.equal(deleteTransferAlert().confirm, "Удалить перевод");
  });
});
