import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  RESCHEDULE_SMS_HOLD_MS,
  rescheduleSmsGoes,
  smsOnMoveWithMemory,
  type KnownSlot,
  type RescheduleSmsInput,
} from "./reschedule-sms-rule";

const base: RescheduleSmsInput = {
  apt: { kind: "work", client_id: "c1", status: "scheduled", date: "2026-11-05", time_start: "10:00" },
  teamId: "team-a",
  date: "2026-11-05",
  timeStart: "12:00",
  client: { phone: "+35799123456", phone_e164: "+35799123456", sms_opt_out: false, blacklisted: false },
  serviceOn: true,
  senders: { "team-a": "AirFix" },
  templates: [{ teamId: "team-a", trigger: "rescheduled", enabled: true }],
  now: "2026-10-27 14:40",
};

const goes = (over: Partial<RescheduleSmsInput>) => rescheduleSmsGoes({ ...base, ...over });

describe("перенос пальцем: уйдёт ли клиенту SMS", () => {
  test("шаблон «При переносе» включён у команды — уйдёт", () => {
    assert.equal(goes({}), true);
    assert.equal(goes({ timeStart: "10:00", date: "2026-11-06" }), true);
  });

  test("о прошедшем визите сервер не пишет — и тост молчит", () => {
    assert.equal(goes({ date: "2026-10-05", timeStart: "14:00" }), false);
    assert.equal(goes({ date: "2026-10-27", timeStart: "14:40" }), false);
    assert.equal(goes({ date: "2026-10-27", timeStart: "15:00" }), true);
  });

  test("растяжка за конец клиенту не пишет — сервер шлёт только на смену дня или начала", () => {
    assert.equal(goes({ timeStart: "10:00" }), false);
  });

  test("без шаблона, отправителя или сервиса — не уйдёт", () => {
    assert.equal(goes({ templates: [{ teamId: "team-a", trigger: "rescheduled", enabled: false }] }), false);
    assert.equal(goes({ templates: [{ teamId: "team-b", trigger: "rescheduled", enabled: true }] }), false);
    assert.equal(goes({ templates: [{ teamId: "team-a", trigger: "cancelled", enabled: true }] }), false);
    assert.equal(goes({ senders: {} }), false);
    assert.equal(goes({ serviceOn: false }), false);
  });

  test("в другую команду — её шаблоны и её отправитель", () => {
    assert.equal(goes({ teamId: "team-b" }), false);
    assert.equal(
      goes({
        teamId: "team-b",
        senders: { "team-b": "CoolAir" },
        templates: [{ teamId: "team-b", trigger: "rescheduled", enabled: true }],
      }),
      true,
    );
  });

  test("клиенту без телефона, с отказом от SMS, событию и отменённой — не уйдёт", () => {
    assert.equal(goes({ client: { phone: "", phone_e164: null, sms_opt_out: false, blacklisted: false } }), false);
    assert.equal(goes({ client: { ...base.client!, sms_opt_out: true } }), false);
    assert.equal(goes({ client: null }), false);
    assert.equal(goes({ apt: { ...base.apt, kind: "event" } }), false);
    assert.equal(goes({ apt: { ...base.apt, status: "cancelled" } }), false);
    assert.equal(goes({ apt: { ...base.apt, client_id: null } }), false);
  });

  test("перенос обратно, пока сообщение ждёт, — SMS не будет (как у сервера)", () => {
    const known = new Map<string, KnownSlot>();
    const at10 = { id: "a1", date: "2026-10-28", time_start: "10:00" };
    const at12 = { ...at10, time_start: "12:00" };
    const at14 = { ...at10, time_start: "14:00" };
    // 10 → 12: уйдёт, клиент знает 10:00.
    assert.equal(smsOnMoveWithMemory(known, at10, "2026-10-28", "12:00", true, 0), true);
    // 12 → 14 за минуту: то же одно сообщение, оно назовёт 14:00.
    assert.equal(smsOnMoveWithMemory(known, at12, "2026-10-28", "14:00", true, 20_000), true);
    // 14 → 10 за минуту: клиент это время знает — сообщение снято.
    assert.equal(smsOnMoveWithMemory(known, at14, "2026-10-28", "10:00", true, 40_000), false);
    // Снова 10 → 12: новое сообщение.
    assert.equal(smsOnMoveWithMemory(known, at10, "2026-10-28", "12:00", true, 45_000), true);
    // Обратно через минуту — сообщение уже ушло, нужно второе.
    assert.equal(
      smsOnMoveWithMemory(known, at12, "2026-10-28", "10:00", true, 45_000 + RESCHEDULE_SMS_HOLD_MS),
      true,
    );
  });
});

