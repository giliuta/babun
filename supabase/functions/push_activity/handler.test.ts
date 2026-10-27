import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  handlePushActivity,
  localToday,
  parseInput,
  type AppointmentRow,
  type DeviceRow,
  type ExpoMessage,
  type ExpoTicket,
  type LogRow,
  type PushDeps,
} from "./handler.ts";

const TENANT = "2dfef93d-cf0e-4885-ba8b-0f9fcebcefd5";
const OWNER = "75f9e64a-3665-4d2e-bb99-f3d68ffad7b9";
const MASTER = "82156ce8-c8df-435a-a200-9100b64d2ac0";
const APPT = "11111111-2222-4333-8444-555555555555";

function fake(overrides: Partial<{ log: LogRow; appointment: AppointmentRow | null; devices: DeviceRow[]; tickets: (m: ExpoMessage[]) => ExpoTicket[] }> = {}) {
  const sent: ExpoMessage[][] = [];
  const dropped: string[][] = [];
  const log: LogRow = overrides.log ?? {
    id: 7,
    tenant_id: TENANT,
    team_id: "team-1",
    entity: "appointments",
    entity_id: APPT,
    action: "insert",
    label: "Иван из журнала",
    meta: { kind: "work", date: "2026-10-27", time: "14:00" },
  };
  const appointment: AppointmentRow | null =
    overrides.appointment === undefined
      ? { id: APPT, date: "2026-10-28", time_start: "09:00", city: "Пафос", client_id: "c1", team_id: "team-1" }
      : overrides.appointment;
  const deps: PushDeps = {
    loadLog: async (id) => (id === log.id ? log : null),
    loadAppointment: async (_t, id) => (appointment && id === appointment.id ? appointment : null),
    loadIncomeAppointmentId: async () => APPT,
    loadClientName: async () => "Мария",
    loadTeam: async () => ({ name: "Y&D", timezone: null }),
    loadOwners: async () => new Set([OWNER]),
    loadCurrency: async () => "EUR",
    loadDevices: async () =>
      overrides.devices ?? [
        { token: "ExponentPushToken[owner-ios]", user_id: OWNER, locale: "ru" },
        { token: "ExponentPushToken[master-a]", user_id: MASTER, locale: "en" },
        { token: "ExponentPushToken[master-b]", user_id: MASTER, locale: "ru" },
      ],
    sendExpo: async (messages) => {
      sent.push(messages);
      return overrides.tickets ? overrides.tickets(messages) : messages.map(() => ({ status: "ok" as const }));
    },
    dropTokens: async (tokens) => {
      dropped.push(tokens);
    },
    now: () => new Date("2026-10-27T10:00:00Z"),
  };
  return { deps, sent, dropped };
}

const target = (user_id: string, kind: string, show_client = true) => ({ user_id, kind, team_id: "team-1", show_client });

describe("push_activity: сборка пушей", () => {
  test("чужое тело не принимается", () => {
    assert.equal(parseInput(null), null);
    assert.equal(parseInput({ log_id: "7", targets: [target(MASTER, "new")] }), null);
    assert.equal(parseInput({ log_id: 7, targets: [] }), null);
    assert.equal(parseInput({ log_id: 7, targets: [target("not-a-uuid", "new")] }), null);
    assert.equal(parseInput({ log_id: 7, targets: [target(MASTER, "hack")] }), null);
    assert.ok(parseInput({ log_id: 7, targets: [target(MASTER, "new")] }));
  });

  test("каждому телефону — на его языке, тап открывает запись", async () => {
    const { deps, sent } = fake();
    const result = await handlePushActivity({ log_id: 7, targets: [target(MASTER, "new")] }, deps);
    assert.deepEqual(result, { sent: 2, failed: 0, dropped: 0 });
    const [batch] = sent;
    assert.deepEqual(
      batch.map((m) => [m.to, m.title, m.body]),
      [
        ["ExponentPushToken[master-a]", "New job assigned to you", "Tomorrow, 09:00, Мария, Пафос"],
        ["ExponentPushToken[master-b]", "Вам назначена работа", "Завтра, 09:00, Мария, Пафос"],
      ],
    );
    // Та же форма, что разбирает `parseAppointmentNotificationTarget` в приложении.
    assert.equal(batch[0].categoryId, "babun-appointment");
    assert.deepEqual(batch[0].data, {
      type: "calendar-appointment",
      appointmentId: APPT,
      date: "2026-10-28",
      teamId: "team-1",
      tenantId: TENANT,
    });
  });

  test("владельцу — «Новая работа»; без права клиента имени нет", async () => {
    const { deps, sent } = fake();
    await handlePushActivity({ log_id: 7, targets: [target(OWNER, "new"), target(MASTER, "change", false)] }, deps);
    const byToken = new Map(sent[0].map((m) => [m.to, m]));
    assert.equal(byToken.get("ExponentPushToken[owner-ios]")?.title, "Новая работа");
    assert.equal(byToken.get("ExponentPushToken[master-b]")?.body, "Завтра, 09:00, Пафос");
  });

  test("удалённая запись: текст из журнала, тап просто открывает приложение", async () => {
    const { deps, sent } = fake({
      log: {
        id: 7,
        tenant_id: TENANT,
        team_id: "team-1",
        entity: "appointments",
        entity_id: APPT,
        action: "delete",
        label: "Иван из журнала",
        meta: { kind: "work", date: "2026-10-27", time: "14:00" },
      },
    });
    await handlePushActivity({ log_id: 7, targets: [target(MASTER, "cancel")] }, deps);
    const message = sent[0].find((m) => m.to === "ExponentPushToken[master-b]");
    assert.equal(message?.body, "14:00, Иван из журнала");
    // Записи нет — открывается её день, и кнопка у отмены «Открыть день».
    assert.deepEqual(message?.data, { type: "calendar-day", date: "2026-10-27", teamId: "team-1", tenantId: TENANT });
    assert.equal(message?.categoryId, "babun-cancel");
  });

  test("доход: сумма и клиент записи, тап — в запись", async () => {
    const { deps, sent } = fake({
      log: {
        id: 7,
        tenant_id: TENANT,
        team_id: "team-1",
        entity: "finance_transactions",
        entity_id: "tx-1",
        action: "insert",
        label: "Доход",
        meta: { type: "income", amount: 120 },
      },
    });
    await handlePushActivity({ log_id: 7, targets: [target(OWNER, "payment")] }, deps);
    assert.equal(sent[0].length, 1);
    assert.equal(sent[0][0].title, "Оплачено 120 €");
    assert.equal(sent[0][0].body, "Мария · Y&D");
    assert.equal(sent[0][0].data.type, "calendar-appointment");
    // У дохода кнопок записи нет.
    assert.equal(sent[0][0].categoryId, undefined);
  });

  test("работу забрали в чужой календарь — тап не ведёт в запись", async () => {
    const { deps, sent } = fake();
    await handlePushActivity({ log_id: 7, targets: [target(MASTER, "moved", false)] }, deps);
    assert.equal(sent[0][0].data.type, "calendar-day");
    assert.equal(sent[0][0].data.appointmentId, undefined);
    assert.equal(sent[0][0].categoryId, undefined);
  });

  test("DeviceNotRegistered — токен забывается, остальные считаются", async () => {
    const { deps, dropped } = fake({
      tickets: (messages) =>
        messages.map((m) =>
          m.to === "ExponentPushToken[master-a]"
            ? { status: "error" as const, details: { error: "DeviceNotRegistered" } }
            : { status: "ok" as const },
        ),
    });
    const result = await handlePushActivity({ log_id: 7, targets: [target(MASTER, "new")] }, deps);
    assert.deepEqual(result, { sent: 1, failed: 1, dropped: 1 });
    assert.deepEqual(dropped, [["ExponentPushToken[master-a]"]]);
  });

  test("больше ста сообщений — пачками по сто", async () => {
    const devices = Array.from({ length: 230 }, (_, i) => ({
      token: `ExponentPushToken[d${i}]`,
      user_id: MASTER,
      locale: "ru",
    }));
    const { deps, sent } = fake({ devices });
    const result = await handlePushActivity({ log_id: 7, targets: [target(MASTER, "new")] }, deps);
    assert.deepEqual(sent.map((b) => b.length), [100, 100, 30]);
    assert.equal(result?.sent, 230);
  });

  test("строки журнала нет — ничего не шлём", async () => {
    const { deps, sent } = fake();
    assert.deepEqual(await handlePushActivity({ log_id: 99, targets: [target(MASTER, "new")] }, deps), {
      sent: 0,
      failed: 0,
      dropped: 0,
    });
    assert.equal(sent.length, 0);
  });

  test("«сегодня» считается в часовом поясе Кипра", () => {
    // 22:30 UTC 27 октября — на Кипре уже 28-е.
    assert.equal(localToday(new Date("2026-10-27T22:30:00Z"), null), "2026-10-28");
    assert.equal(localToday(new Date("2026-10-27T22:30:00Z"), "UTC"), "2026-10-27");
  });
});
