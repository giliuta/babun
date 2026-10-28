import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { parseAppointmentNotificationTarget, parseDayNotificationTarget } from "../features/calendar/reminders";
import { APPOINTMENT_CATEGORY, CANCEL_CATEGORY, pushActionFrom } from "../features/calendar/push-action-ids";

const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string) => readFileSync(resolve(here, path), "utf8");

// ПУШ С СЕРВЕРА — ТА ЖЕ ДВЕРЬ, ЧТО И МЕСТНОЕ НАПОМИНАНИЕ, И ТЕ ЖЕ ПРАВИЛА
// ПРИВАТНОСТИ: на телефоне после «Выйти» не должно остаться ни одного
// канала, по которому сюда приедут клиенты прежнего человека.

describe("пуш о делах команды", () => {
  test("ВЫХОД: телефон уходит из получателей ДО того, как пропадёт сессия", () => {
    const source = read("auth-clear.ts");
    assert.match(
      source,
      /if \(scope === "global"\) await forgetOtherDevices\(\);\s*await forgetThisDevice\(\);\s*const \{ error \} = await supabase\.auth\.signOut\(\{ scope \}\);/,
    );
  });

  test("«Выйти на других устройствах» снимает и их пуши", () => {
    const source = read("../features/cabinet/account/DevicesSection.tsx");
    assert.match(source, /signOut\(\{ scope: "others" \}\);[\s\S]*?await forgetOtherDevices\(\);/);
  });

  test("сервер шлёт пуши — опрос журнала молчит, новость не приходит дважды", () => {
    const source = read("../features/cabinet/TeamActivityNotifier.tsx");
    assert.match(source, /serverPushLive\(\)\) return;/);
  });

  test("тап по пушу сервера открывает запись тем же разбором, что и напоминание", () => {
    // Форма данных, которую собирает `supabase/functions/push_activity/handler.ts`.
    const server = read("../../../../supabase/functions/push_activity/handler.ts");
    for (const key of ['type: "calendar-appointment"', "appointmentId: appointment.id", "date: appointment.date", "teamId: appointment.team_id", "tenantId: log.tenant_id"]) {
      assert.ok(server.includes(key), key);
    }
    assert.deepEqual(
      parseAppointmentNotificationTarget({
        type: "calendar-appointment",
        appointmentId: "11111111-2222-4333-8444-555555555555",
        date: "2026-10-28",
        teamId: "team-1",
        tenantId: "2dfef93d-cf0e-4885-ba8b-0f9fcebcefd5",
      }),
      {
        appointmentId: "11111111-2222-4333-8444-555555555555",
        date: "2026-10-28",
        teamId: "team-1",
        tenantId: "2dfef93d-cf0e-4885-ba8b-0f9fcebcefd5",
      },
    );
  });

  test("регистрация не задаёт системный вопрос сама — только при входе, один раз", () => {
    const device = read("push-device.ts");
    assert.match(device, /if \(!permission\.granted && permission\.canAskAgain && options\.askOnce\)/);
    const registrar = read("../features/cabinet/PushRegistrar.tsx");
    assert.match(registrar, /registerThisDevice\(\{ askOnce: true \}\)/);
    assert.match(registrar, /void registerThisDevice\(\);/);
  });

  test("тап сперва перечитывает записи: у мастера живого канала нет", () => {
    const layout = read("../../app/_layout.tsx");
    assert.match(
      layout,
      /void refreshAppointmentsForTap\(\)\.then\(\(\) => \{\s*if \(!active\) return;[\s\S]{0,400}?router\.push\(\{\s*pathname: "\/",\s*params: \{\s*appointmentId: target\.appointmentId,/,
    );
    const tap = read("notification-tap.ts");
    // Только активный аккаунт: чужой ключ получил бы записи текущего заголовка.
    assert.match(tap, /refetchQueries\(\{ queryKey: \["appointments", tenantId\], type: "all" \}\)/);
  });

  test("старый веб-пуш ведёт на настоящие маршруты и говорит на «вы»", () => {
    const legacy = read("../../../../supabase/functions/send_push/index.ts");
    assert.doesNotMatch(legacy, /\/dashboard/);
    assert.doesNotMatch(legacy, /"Открой /);
    for (const [, url] of legacy.matchAll(/url: "(\/[^"]*)"/g)) {
      const route = url === "/" ? "(dashboard)/(home)/index.tsx" : `(dashboard)${url}/index.tsx`;
      assert.ok(readFileSync(resolve(here, "../../app", route)), url);
    }
  });

  test("кнопки уведомления: категории приложения совпадают с сервером", () => {
    const server = read("../../../../supabase/functions/push_activity/handler.ts");
    assert.ok(server.includes(`APPOINTMENT_CATEGORY = "${APPOINTMENT_CATEGORY}"`));
    assert.ok(server.includes(`CANCEL_CATEGORY = "${CANCEL_CATEGORY}"`));
    const actions = read("../features/calendar/push-actions.ts");
    for (const id of ['identifier: "call"', 'identifier: "route"', 'identifier: "open-day"']) {
      assert.ok(actions.includes(id), id);
    }
    assert.equal(pushActionFrom("call"), "call");
    assert.equal(pushActionFrom("route"), "route");
    assert.equal(pushActionFrom("open-day"), "day");
    // Тап по самому уведомлению и «Открыть» — обычное открытие записи.
    assert.equal(pushActionFrom("open"), undefined);
    assert.equal(pushActionFrom("expo.modules.notifications.actions.DEFAULT"), undefined);
  });

  test("удалённая работа: тап открывает её день", () => {
    const tenantId = "2dfef93d-cf0e-4885-ba8b-0f9fcebcefd5";
    assert.deepEqual(parseDayNotificationTarget({ type: "calendar-day", date: "2026-10-30", teamId: "t", tenantId }), {
      date: "2026-10-30",
      teamId: "t",
      tenantId,
    });
    assert.equal(parseDayNotificationTarget({ type: "calendar-day", date: "30.10.2026" }), null);
    assert.equal(parseDayNotificationTarget({ type: "calendar-appointment", date: "2026-10-30" }), null);
  });

  test("миграция: устройства пишет только функция, помощники закрыты от клиента", () => {
    const sql = read("../../../../supabase/migrations/20261027162300_mobile_push.sql");
    assert.match(sql, /grant select, delete on public\.push_devices to authenticated;/);
    assert.match(sql, /revoke all on function public\.push_activity_targets\(public\.change_log\) from public, anon, authenticated;/);
    assert.match(sql, /revoke all on function public\.register_push_device\(text, text, text\) from public, anon;/);
    // Выключатель отдельный от старого веб-пуша и стартует выключенным.
    assert.match(sql, /values \('mobile_push_enabled', 'off'\)/);
  });
});
