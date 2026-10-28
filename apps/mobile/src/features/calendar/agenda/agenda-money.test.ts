import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { formatEUR } from "@babun/shared/common/utils/money";
import { agendaMoney, agendaStatusWord } from "./agenda-money";

// Долг строки «Списка» говорится один раз: «Долг €60».
describe("деньги строки «Списка»", () => {
  const eur = formatEUR;

  test("ничего не оплачено после визита — одна строка «Долг €60»", () => {
    const m = agendaMoney({ total: 60, debt: 60, cancelled: false, afterVisit: true });
    assert.deepEqual(m, {
      amount: `Долг ${eur(60)}`,
      amountWarn: true,
      note: null,
      noteWarn: false,
      debtSaid: true,
    });
  });

  test("оплачена часть — сумма визита сверху, долг под ней", () => {
    const m = agendaMoney({ total: 100, debt: 60, cancelled: false, afterVisit: true });
    assert.equal(m?.amount, eur(100));
    assert.equal(m?.note, `Долг ${eur(60)}`);
    assert.equal(m?.noteWarn, true);
    assert.equal(m?.debtSaid, true);
  });

  test("оплачено всё — только сумма", () => {
    const m = agendaMoney({ total: 100, debt: 0, cancelled: false, afterVisit: true });
    assert.deepEqual(m, {
      amount: eur(100),
      amountWarn: false,
      note: null,
      noteWarn: false,
      debtSaid: false,
    });
  });

  test("визит впереди — не долг, а «к оплате»", () => {
    const m = agendaMoney({ total: 60, debt: 60, cancelled: false, afterVisit: false });
    assert.equal(m?.amount, eur(60));
    assert.equal(m?.note, `${eur(60)} к оплате`);
    assert.equal(m?.debtSaid, false);
  });

  test("отменённая — сумма без долга и без «к оплате»", () => {
    const m = agendaMoney({ total: 60, debt: 60, cancelled: true, afterVisit: true });
    assert.equal(m?.amount, eur(60));
    assert.equal(m?.note, null);
    assert.equal(m?.debtSaid, false);
  });

  test("без суммы — денег в строке нет", () => {
    assert.equal(agendaMoney({ total: 0, debt: 0, cancelled: false, afterVisit: true }), null);
  });
});

describe("слово слева — одно о деньгах", () => {
  const word = (patch: Partial<Parameters<typeof agendaStatusWord>[0]>) =>
    agendaStatusWord({
      cancelled: false,
      overdue: true,
      debt: 60,
      debtSaid: false,
      situationSaysDebt: false,
      ...patch,
    });

  test("прошедшая запись на €0 — без «Не оплачена»", () => {
    assert.equal(word({ debt: 0 }), null);
  });

  test("суммы скрыты, ситуация «Долг» — «Не оплачена» не добавляется", () => {
    assert.equal(word({ situationSaysDebt: true }), null);
  });

  test("долг сказан суммой справа — слева молчим", () => {
    assert.equal(word({ debtSaid: true }), null);
  });

  test("долг нигде не назван — «Не оплачена»; визит впереди — ничего", () => {
    assert.equal(word({}), "Не оплачена");
    assert.equal(word({ overdue: false }), null);
  });

  test("отменённая — «Отменена»", () => {
    assert.equal(word({ cancelled: true, overdue: false }), "Отменена");
  });
});
