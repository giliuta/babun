import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildStats, nameInComment } from "./client-stats";

// Границы слова для привязки старых записей (client_id=null) к клиенту
// по имени в комментарии. Оба аргумента уже нормализованы (lowercase,
// схлопнутые пробелы) вызывающей стороной.
describe("nameInComment", () => {
  test("matches the name as a whole phrase inside longer text", () => {
    assert.equal(nameInComment("иван петров, сплит 12", "иван петров"), true);
    assert.equal(nameInComment("оплата — анна", "анна"), true);
    assert.equal(nameInComment("мария", "мария"), true);
  });

  test("does NOT match a short name as a substring of another word", () => {
    // Главный баг: «Ан» ловил «диван», «Иван» ловил «Иванов».
    assert.equal(nameInComment("починили диван", "ан"), false);
    assert.equal(nameInComment("иванов сергей", "иван"), false);
    assert.equal(nameInComment("кондиционер", "дицион"), false);
  });

  test("empty name never matches", () => {
    assert.equal(nameInComment("любой текст", ""), false);
  });
});

// ДОЛГ ВКЛЮЧАЕТ НЕЗАКРЫТУЮ РАБОТУ (решение владельца 2026-08-09): прошло
// время записи — деньги не получены, и не важно, отметил бригадир или нет.
// Отдельной корзины «не закрыто» в деньгах нет: она делила одно надвое.
describe("долг по незакрытой работе", () => {
  const CLIENT = { id: "c1", full_name: "Клиент" } as never;

  function apt(over: Record<string, unknown>) {
    return {
      id: "a1",
      client_id: "c1",
      date: "2020-01-01",
      time_start: "10:00",
      status: "scheduled",
      kind: "work",
      total_amount: 100,
      prepaid_amount: 0,
      paid_amount: 0,
      payments: [],
      ...over,
    } as never;
  }

  test("прошедшая незакрытая запись считается долгом", () => {
    assert.equal(buildStats(CLIENT, [apt({})]).debt, 100);
  });

  test("но визитом не считается — визиты только подтверждённые", () => {
    assert.equal(buildStats(CLIENT, [apt({})]).visits, 0);
  });

  test("будущая запись долгом не становится", () => {
    assert.equal(buildStats(CLIENT, [apt({ date: "2099-01-01" })]).debt, 0);
  });

  test("отменённая не в счёт", () => {
    assert.equal(buildStats(CLIENT, [apt({ status: "cancelled" })]).debt, 0);
  });

  test("завершённая и оплаченная долга не даёт", () => {
    const paid = apt({
      status: "completed",
      payments: [{ id: "p", method: "cash", amount: 100, paid_at: "2020-01-01" }],
    });
    assert.equal(buildStats(CLIENT, [paid]).debt, 0);
  });
});
