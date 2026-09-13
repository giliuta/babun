import assert from "node:assert/strict";
import { describe, test } from "node:test";

import * as keys from "./company-query-keys";

// УСЛОВИЕ СЕССИИ 005 ПРИ ПЕРЕДАЧЕ ФАЙЛОВ: «ключи экспортируй, но не меняй
// значений — если при переносе хоть один поменяет форму, тёплый кэш молча
// станет холодным. Нужен тест, сверяющий ключи строкой, а не глазами».
//
// Справа — буквально те массивы, которые стояли в хуках ДО переноса
// (calendar/queries.ts, clients/queries.ts, reference/queries.ts,
// services/queries.ts, team-schedule.ts, local-settings.ts, settings/tenant.ts,
// day-cities.ts). Сравнение — строкой.
const T = "2bc7907e-b149-44a9-92ff-a5e73403031c";
const same = (a: readonly unknown[], b: readonly unknown[]) =>
  assert.equal(JSON.stringify(a), JSON.stringify(b));

describe("ключи запросов компании не изменили форму при переносе", () => {
  test("роль", () => {
    same(keys.currentRoleQueryKey(T), ["current-role", T]);
    same(keys.currentRoleQueryKey(null), ["current-role", null]);
  });
  test("записи, клиенты, теги", () => {
    same(keys.appointmentsQueryKey(T, "owner"), ["appointments", T, "owner"]);
    same(keys.appointmentsQueryKey(T, undefined), ["appointments", T, "role-pending"]);
    same(keys.clientsQueryKey(T, "master"), ["clients", T, "master"]);
    same(keys.clientTagsQueryKey(T, null), ["client-tags", T, "role-pending"]);
  });
  test("команды: без суффикса и с «all»", () => {
    same(keys.teamsQueryKey(T, "owner", false), ["teams", T, "owner"]);
    same(keys.teamsQueryKey(T, "owner", true), ["teams", T, "owner", "all"]);
  });
  test("города: live/all и команда", () => {
    same(keys.citiesQueryKey(T, false, null), ["cities", T, "live", null]);
    same(keys.citiesQueryKey(T, true, "team-1"), ["cities", T, "all", "team-1"]);
  });
  test("услуги: активные и с архивом (порядок элементов разный!)", () => {
    same(keys.servicesQueryKey(T, "dispatcher"), ["services", T, "dispatcher"]);
    same(keys.allServicesQueryKey(T, "owner"), ["services", "with-archived", T, "owner"]);
  });
  test("настройки календаря, города дня, ручные операции, профиль", () => {
    same(keys.calendarSettingsQueryKey(T, "owner"), ["calendar-settings", T, "owner"]);
    same(keys.dayCitiesQueryKey(T, "owner"), ["day-cities", T, "owner"]);
    same(keys.dayExtrasQueryKey(T, "owner"), ["day-extras", T, "owner"]);
    same(keys.tenantQueryKey(T, "master"), ["tenant", T, "master"]);
  });
  test("расписания: одной команды и всех", () => {
    same(keys.teamScheduleQueryKey(T, "owner", "team-1"), ["team-schedules", T, "owner", "team-1"]);
    same(keys.allTeamSchedulesQueryKey(T, "owner"), ["team-schedules", T, "owner", "all"]);
  });
});
