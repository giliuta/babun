import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildStats, buildStatsMap, nameInComment } from "./client-stats";

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

// ДОЛГ ВКЛЮЧАЕТ НЕЗАКРЫТУЮ РАБОТУ: прошло
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

  test("долг в центах: копейки не пропадают и не округляются до евро", () => {
    assert.equal(buildStats(CLIENT, [apt({ total_amount: 0.4 })]).debt, 0.4);
    assert.equal(buildStats(CLIENT, [apt({ total_amount: 12.6 })]).debt, 12.6);
  });

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

// «СЕГОДНЯ» — ДЕНЬ БИЗНЕСА, А НЕ ТЕЛЕФОНА: владелец в другом поясе
// после своей полуночи видел бы долгом запись, у команды ещё сегодняшнюю.
// Сводка считает от переданной даты (часовой пояс календаря).
describe("сводка клиента считает от дня бизнеса", () => {
  const CLIENT = { id: "c1", full_name: "Клиент", created_at: "2026-10-10T08:00:00Z", birthday: "1990-10-20" } as never;
  const record = {
    id: "a1",
    client_id: "c1",
    date: "2026-10-18",
    time_start: "10:00",
    status: "scheduled",
    kind: "work",
    total_amount: 100,
    prepaid_amount: 0,
    paid_amount: 0,
    payments: [],
  } as never;

  test("запись дня бизнеса — ещё не долг, а впереди", () => {
    const stats = buildStats(CLIENT, [record], undefined, "2026-10-18");
    assert.equal(stats.debt, 0);
    assert.equal(stats.nextAptDays, 0);
    assert.equal(stats.expectedRevenue, 100);
  });

  test("на следующий день бизнеса та же запись — долг", () => {
    const stats = buildStats(CLIENT, [record], undefined, "2026-10-19");
    assert.equal(stats.debt, 100);
    assert.equal(stats.unclosedVisits, 1);
  });

  test("дни с заведения и до дня рождения — от того же дня", () => {
    const stats = buildStats(CLIENT, [], undefined, "2026-10-18");
    assert.equal(stats.ageDays, 8);
    assert.equal(stats.birthdayInDays, 2);
  });

  test("карта клиентов передаёт день каждому", () => {
    const map = buildStatsMap([CLIENT], [record], undefined, "2026-10-19");
    assert.equal(map.get("c1")?.debt, 100);
  });
});
