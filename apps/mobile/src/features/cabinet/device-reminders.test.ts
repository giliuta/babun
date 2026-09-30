import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  devicePermissionFrom,
  notificationsSummary,
  permissionRow,
  reminderCanCancel,
  reminderCount,
  reminderDays,
  reminderRow,
  reminderSource,
  remindersSilenced,
  type DeviceReminder,
} from "./device-reminders";

const APPOINTMENT_ID = "0b6f2d1e-3c4a-4b5d-8e9f-a1b2c3d4e5f6";
const CLIENT_ID = "9c8b7a6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d";

function appointment(
  fireAt: Date,
  overrides: Partial<DeviceReminder> = {},
): DeviceReminder {
  return {
    logicalId: `appointment:${APPOINTMENT_ID}:${fireAt.toISOString()}`,
    ownerKey: `appointment:${APPOINTMENT_ID}`,
    fireAt: fireAt.getTime(),
    title: "Запись 10:00",
    subtitle: "За 30 минут",
    body: "Иван Петров\nул. Ленина 5",
    data: {
      type: "calendar-appointment",
      appointmentId: APPOINTMENT_ID,
      date: "2026-09-15",
      teamId: "team-1",
    },
    ...overrides,
  };
}

describe("reminderSource", () => {
  test("ручное напоминание записи, событие и клиент различаются по владельцу", () => {
    const base = appointment(new Date(2026, 8, 15, 9, 30));
    assert.deepEqual(reminderSource(base), {
      kind: "appointment",
      appointmentId: APPOINTMENT_ID,
      date: "2026-09-15",
      teamId: "team-1",
    });
    assert.equal(
      reminderSource({ ...base, ownerKey: `event:${APPOINTMENT_ID}` }).kind,
      "event",
    );
    assert.deepEqual(
      reminderSource({
        ownerKey: `client:${CLIENT_ID}`,
        data: { type: "client-reminder", clientId: CLIENT_ID },
      }),
      { kind: "client", clientId: CLIENT_ID },
    );
  });

  test("отменить можно только ручное напоминание записи — остальное вернёт база", () => {
    const base = appointment(new Date(2026, 8, 15, 9, 30));
    assert.equal(reminderCanCancel(reminderSource(base)), true);
    assert.equal(
      reminderCanCancel(reminderSource({ ...base, ownerKey: `event:${APPOINTMENT_ID}` })),
      false,
    );
    assert.equal(reminderCanCancel({ kind: "client", clientId: CLIENT_ID }), false);
    assert.equal(reminderCanCancel({ kind: "other" }), false);
  });

  test("битый или чужой payload не становится дверью", () => {
    const base = appointment(new Date(2026, 8, 15, 9, 30));
    assert.equal(
      reminderSource({ ...base, data: { type: "calendar-appointment" } }).kind,
      "other",
    );
    assert.equal(
      reminderSource({ ...base, data: { ...base.data, date: "15.09.2026" } }).kind,
      "other",
    );
    assert.equal(
      reminderSource({ ownerKey: "client:x", data: { type: "calendar-appointment" } })
        .kind,
      "other",
    );
    assert.equal(reminderSource({ ownerKey: "legacy", data: {} }).kind, "other");
  });
});

describe("reminderRow", () => {
  test("имя из тела, подпись — что и за сколько, справа — когда зазвонит", () => {
    const row = reminderRow(appointment(new Date(2026, 8, 15, 9, 30)));
    assert.equal(row.title, "Иван Петров");
    assert.equal(row.sub, "Запись 10:00 · за 30 минут");
    assert.equal(row.time, "09:30");
    assert.equal(row.key, `appointment:${APPOINTMENT_ID}`);
  });

  test("без имени строку называет само уведомление", () => {
    const row = reminderRow(appointment(new Date(2026, 8, 15, 9, 30), { body: null }));
    assert.equal(row.title, "Запись 10:00");
    assert.equal(row.sub, "За 30 минут");
  });

  test("клиентское напоминание называет клиента, а не телефон", () => {
    const row = reminderRow({
      logicalId: `client:${CLIENT_ID}:2026-09-16`,
      ownerKey: `client:${CLIENT_ID}`,
      fireAt: new Date(2026, 8, 16, 9, 0).getTime(),
      title: "Напоминание о клиенте",
      subtitle: null,
      body: "Мария · +357 99 123456",
      data: { type: "client-reminder", clientId: CLIENT_ID },
    });
    assert.equal(row.title, "Мария");
    assert.equal(row.sub, "Напоминание о клиенте");
    assert.equal(row.time, "09:00");
  });
});

describe("reminderDays", () => {
  const now = new Date(2026, 8, 15, 8, 0).getTime();

  test("прошедшее уходит, у источника остаётся ближайшее, дни подписаны словами", () => {
    const eventKey = `event:${APPOINTMENT_ID}`;
    const days = reminderDays(
      [
        appointment(new Date(2026, 8, 15, 7, 0)), // уже прошло
        appointment(new Date(2026, 8, 15, 9, 30)),
        {
          ...appointment(new Date(2026, 8, 25, 8, 45)),
          ownerKey: eventKey,
          logicalId: "e2",
        },
        {
          ...appointment(new Date(2026, 8, 18, 8, 45)),
          ownerKey: eventKey,
          logicalId: "e1",
        },
        {
          ...appointment(new Date(2026, 8, 16, 20, 0)),
          ownerKey: "appointment:other",
          logicalId: "o1",
        },
      ],
      now,
    );
    assert.deepEqual(
      days.map((day) => [day.title, day.rows.map((row) => `${row.key} ${row.time}`)]),
      [
        ["Сегодня", [`appointment:${APPOINTMENT_ID} 09:30`]],
        ["Завтра", ["appointment:other 20:00"]],
        ["Пятница, 18 сентября", [`${eventKey} 08:45`]],
      ],
    );
    assert.equal(reminderCount(days), 3);
  });

  test("другой год пишется в заголовке дня", () => {
    const days = reminderDays([appointment(new Date(2027, 0, 4, 9, 0))], now);
    assert.equal(days[0]?.title, "Понедельник, 4 января 2027");
  });

  test("пусто — ни одного дня", () => {
    assert.deepEqual(reminderDays([], now), []);
  });
});

describe("разрешение и подписи", () => {
  test("ответ iOS превращается в одно из четырёх состояний", () => {
    assert.equal(devicePermissionFrom(null), "unavailable");
    assert.equal(devicePermissionFrom({ granted: true, status: "granted" }), "granted");
    assert.equal(devicePermissionFrom({ granted: false, status: "denied" }), "denied");
    assert.equal(
      devicePermissionFrom({ granted: false, status: "undetermined" }),
      "undetermined",
    );
  });

  test("подпись строки-двери: состояние и число напоминаний", () => {
    assert.equal(notificationsSummary("granted", 0), "Разрешены");
    assert.equal(notificationsSummary("granted", 1), "Разрешены · 1 напоминание");
    assert.equal(notificationsSummary("granted", 3), "Разрешены · 3 напоминания");
    assert.equal(notificationsSummary("denied", 5), "Выключены · 5 напоминаний");
    assert.equal(notificationsSummary("undetermined", 0), "Не разрешены");
    assert.equal(notificationsSummary("unavailable", 4), "Недоступны в этой сборке");
  });

  test("янтарь — только когда напоминания есть, а зазвонить им не дадут", () => {
    assert.equal(remindersSilenced("denied", 2), true);
    assert.equal(remindersSilenced("undetermined", 1), true);
    assert.equal(remindersSilenced("denied", 0), false);
    assert.equal(remindersSilenced("granted", 3), false);
    assert.equal(remindersSilenced("unavailable", 3), false);
  });

  test("после отказа приложение не спрашивает, а ведёт в настройки iPhone", () => {
    assert.equal(permissionRow("undetermined").action, "request");
    assert.equal(permissionRow("denied").action, "settings");
    assert.equal(permissionRow("granted").action, "settings");
    assert.equal(permissionRow("unavailable").action, null);
  });
});
