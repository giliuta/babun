import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { MemberAccessMap } from "@/features/access/access-map";
import { paymentRights, type PaymentCalendar } from "./payment-rights";

// «КТО МОЖЕТ БРАТЬ ДЕНЬГИ» — ПРАВИЛО, А НЕ РАЗМЕТКА.
//
// Оно жило посреди блока оплаты и проверялось только глазами. Самое важное
// здесь — зеркало: право считалось по ленте ВОШЕДШЕГО, а владельцу сервер
// ставит грант `finance` на каждый календарь, поэтому в предпросмотре плитки
// оплаты горели всегда, что бы владелец ни выставил.

const TEAM = "team-1";
const OTHER = "team-2";

const map = (levels: Record<string, string>): MemberAccessMap => ({
  tenantId: "tenant-1",
  isOwner: false,
  version: 1,
  company: {},
  calendars: { [TEAM]: levels as never },
  attachedCalendars: [TEAM],
});

const calendar = (over: Partial<PaymentCalendar>): PaymentCalendar => ({
  teamId: TEAM,
  isActive: true,
  grants: [],
  ...over,
});

describe("права блока «Оплата»", () => {
  test("владелец берёт деньги в любом календаре", () => {
    const rights = paymentRights({
      role: "owner",
      map: undefined,
      teamId: TEAM,
      myCalendars: [],
      mirror: null,
    });
    assert.equal(rights.takeMoney, true);
  });

  test("сотрудник — только там, где ему открыли деньги старым грантом", () => {
    const myCalendars = [calendar({ grants: ["finance"] }), calendar({ teamId: OTHER })];
    assert.equal(
      paymentRights({ role: "master", map: undefined, teamId: TEAM, myCalendars, mirror: null })
        .takeMoney,
      true,
    );
    assert.equal(
      paymentRights({ role: "master", map: undefined, teamId: OTHER, myCalendars, mirror: null })
        .takeMoney,
      false,
    );
  });

  test("архивный календарь права не даёт", () => {
    const myCalendars = [calendar({ grants: ["finance"], isActive: false })];
    assert.equal(
      paymentRights({ role: "master", map: undefined, teamId: TEAM, myCalendars, mirror: null })
        .takeMoney,
      false,
    );
  });

  // Главная проверка. Владелец смотрит чужими глазами; его собственная лента
  // разрешает всё, и раньше плитки оплаты в предпросмотре горели всегда.
  test("в зеркале решает карта сотрудника, а не лента владельца", () => {
    const ownersCalendars = [
      calendar({ grants: ["finance"] }),
      calendar({ teamId: OTHER, grants: ["finance"] }),
    ];
    const mirror = map({ "finance.operations": "off" });

    assert.equal(
      paymentRights({
        role: "master",
        map: mirror,
        teamId: TEAM,
        myCalendars: ownersCalendars,
        mirror,
      }).takeMoney,
      true,
      "он прикреплён к этому календарю — деньги брать может",
    );
    assert.equal(
      paymentRights({
        role: "master",
        map: mirror,
        teamId: OTHER,
        myCalendars: ownersCalendars,
        mirror,
      }).takeMoney,
      false,
      "к этому календарю он не прикреплён — плитки гореть не должны",
    );
  });

  test("история платежей открыта от «Доходов и расходов»", () => {
    const seen = (level: string) =>
      paymentRights({
        role: "master",
        map: map({ "finance.operations": level }),
        teamId: TEAM,
        myCalendars: [],
        mirror: null,
      }).seeHistory;
    assert.equal(seen("off"), false);
    assert.equal(seen("read"), true);
    assert.equal(seen("write"), true);
  });

  test("счёт заводит только тот, кто меняет счета", () => {
    const can = (level: string) =>
      paymentRights({
        role: "master",
        map: map({ "finance.accounts": level }),
        teamId: TEAM,
        myCalendars: [],
        mirror: null,
      }).createAccount;
    assert.equal(can("off"), false);
    assert.equal(can("read"), false);
    assert.equal(can("write"), true);
  });

  // ШОВ ПОД СЕРВЕРНУЮ ВОЛНУ. Блок «Оплата в записи» сервер пока не проверяет,
  // и в карте прав его нет вовсе. В день, когда он оживёт, ключ появится — и
  // правило обязано начать слушаться уровня само, без выпуска приложения.
  describe("когда «Оплата в записи» оживёт", () => {
    const withPayment = (level: string): MemberAccessMap => ({
      tenantId: "tenant-1",
      isOwner: false,
      version: 2,
      company: {},
      calendars: { [TEAM]: { "record.payment": level } as never },
      attachedCalendars: [TEAM],
    });
    // Старый грант разрешает — но уровень запрещает.
    const oldGrantAllows = [calendar({ grants: ["finance"] })];

    test("уровень побеждает старый грант", () => {
      assert.equal(
        paymentRights({
          role: "master",
          map: withPayment("off"),
          teamId: TEAM,
          myCalendars: oldGrantAllows,
          mirror: null,
        }).takeMoney,
        false,
        "блок ожил и запретил — грант больше не решает",
      );
      assert.equal(
        paymentRights({
          role: "master",
          map: withPayment("write"),
          teamId: TEAM,
          myCalendars: [],
          mirror: null,
        }).takeMoney,
        true,
        "блок ожил и разрешил — грант не нужен",
      );
    });

    test("«Смотрит» деньги брать не даёт", () => {
      assert.equal(
        paymentRights({
          role: "master",
          map: withPayment("read"),
          teamId: TEAM,
          myCalendars: oldGrantAllows,
          mirror: null,
        }).takeMoney,
        false,
      );
    });

    test("зеркало переключится вместе с сервером", () => {
      const mirror = withPayment("off");
      assert.equal(
        paymentRights({
          role: "master",
          map: mirror,
          teamId: TEAM,
          myCalendars: [calendar({ grants: ["finance"] })],
          mirror,
        }).takeMoney,
        false,
        "в предпросмотре уровень тоже главнее прикрепления",
      );
    });

    test("владелец берёт деньги при любом уровне", () => {
      assert.equal(
        paymentRights({
          role: "owner",
          map: withPayment("off"),
          teamId: TEAM,
          myCalendars: [],
          mirror: null,
        }).takeMoney,
        true,
      );
    });
  });
});
