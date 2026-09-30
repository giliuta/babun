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
  test("своя карта прав: компания вторым сегментом — её находит сигнал", () => {
    same(keys.myAccessQueryKey(T), ["my-access", T]);
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

// ВТОРАЯ ВОЛНА ПЕРЕЕЗДА (прогрев, 2026-09-13): ключи денег, инвойсов и
// мастеров. Справа — буквально массивы из finances/queries.ts,
// finances/accounts.ts, invoices/queries.ts, reference/queries.ts до переноса.
describe("ключи денег и мастеров не изменили форму при переносе", () => {
  test("мастера: без суффикса и с «all»", () => {
    same(keys.mastersQueryKey(T, "owner", false), ["masters", T, "owner"]);
    same(keys.mastersQueryKey(T, undefined, true), ["masters", T, "role-pending", "all"]);
  });
  test("категории, срез журнала, возвраты", () => {
    same(keys.financeCategoriesQueryKey(T), ["finance-categories", T]);
    same(
      keys.ledgerRangeQueryKey(T, "2026-09-01", "2026-09-30", null, null),
      ["transactions", T, "2026-09-01", "2026-09-30", null, null],
    );
    same(
      keys.ledgerRangeQueryKey(T, "2026-09-01", "2026-09-30", ["team-1"], ["acc-1"]),
      ["transactions", T, "2026-09-01", "2026-09-30", ["team-1"], ["acc-1"]],
    );
    same(keys.refundTotalsQueryKey(T), ["transactions", T, "refund-totals"]);
  });
  test("инвойсы и платежи по ним", () => {
    same(keys.invoicesQueryKey(T), ["invoices", T]);
    same(keys.invoicePaymentsQueryKey(T), ["invoices", T, "payments"]);
  });
  test("счета: строки active/all и остатки", () => {
    same(keys.accountRowsQueryKey(T, false), ["accounts", T, "rows", "active"]);
    same(keys.accountRowsQueryKey(T, true), ["accounts", T, "rows", "all"]);
    same(keys.accountBalancesQueryKey(T), ["accounts", T, "balances"]);
  });
  // ТРЕТЬЯ ВОЛНА (2026-09-15): долги. Справа — буквально массивы из
  // finances/debts-queries.ts до переноса: `["debts", tenantId, from, to,
  // teamId ?? null]` и `["debts", tenantId, "paid-totals"]`.
  test("долги: срез периода и суммы платежей", () => {
    same(
      keys.debtsRangeQueryKey(T, "2026-09-01", "2026-09-30", null),
      ["debts", T, "2026-09-01", "2026-09-30", null],
    );
    same(
      keys.debtsRangeQueryKey(T, "2026-09-01", "2026-09-30", "team-1"),
      ["debts", T, "2026-09-01", "2026-09-30", "team-1"],
    );
    same(keys.debtPaidTotalsQueryKey(T), ["debts", T, "paid-totals"]);
  });
});

// УСЛОВИЕ СЕССИИ 004 (2026-09-13): по деньгам сбросы идут ПРЕФИКСОМ —
// `["transactions"]`, `["accounts"]`, `["invoices"]`, `["payment-accounts"]`,
// `["finance-categories"]`, `["masters"]` (payment-mutations.ts,
// invoices/queries.ts, finances/queries.ts, finances/accounts.ts,
// settings/tenant.ts). Смени фабрика первый сегмент — оплата пройдёт, а
// остаток и лента останутся старыми до ручного обновления, без единой ошибки.
describe("первые сегменты ключей денег — те, по которым идут сбросы", () => {
  test("журнал и возвраты — «transactions»", () => {
    assert.equal(keys.ledgerRangeQueryKey(T, "a", "b", null, null)[0], "transactions");
    assert.equal(keys.refundTotalsQueryKey(T)[0], "transactions");
  });
  test("счета и остатки — «accounts», кассы оплаты — «payment-accounts»", () => {
    assert.equal(keys.accountRowsQueryKey(T, false)[0], "accounts");
    assert.equal(keys.accountBalancesQueryKey(T)[0], "accounts");
    assert.equal(keys.paymentAccountsQueryKey(T, "team-1")[0], "payment-accounts");
    same(keys.paymentAccountsQueryKey(T, null), ["payment-accounts", T, "no-team"]);
    same(keys.paymentAccountsQueryKey(T, "team-1"), ["payment-accounts", T, "team-1"]);
  });
  test("инвойсы, категории, мастера", () => {
    assert.equal(keys.invoicesQueryKey(T)[0], "invoices");
    assert.equal(keys.invoicePaymentsQueryKey(T)[0], "invoices");
    assert.equal(keys.financeCategoriesQueryKey(T)[0], "finance-categories");
    assert.equal(keys.mastersQueryKey(T, "owner", false)[0], "masters");
  });
  // Долги сбрасываются префиксом `["debts"]` (debts-queries.ts,
  // finances/queries.ts, экран «Финансы»). И компания — ВТОРЫМ элементом у
  // журнала и долгов: по нему заглушка загрузки решает, своя ли компания
  // (`placeholderWithinTenant`). Сдвинь её — и деньги прошлой компании снова
  // встанут под шапкой новой.
  test("долги — «debts»; компания вторым элементом у журнала и долгов", () => {
    assert.equal(keys.debtsRangeQueryKey(T, "a", "b", null)[0], "debts");
    assert.equal(keys.debtPaidTotalsQueryKey(T)[0], "debts");
    assert.equal(keys.debtsRangeQueryKey(T, "a", "b", null)[1], T);
    assert.equal(keys.debtPaidTotalsQueryKey(T)[1], T);
    assert.equal(keys.ledgerRangeQueryKey(T, "a", "b", null, null)[1], T);
  });
});
