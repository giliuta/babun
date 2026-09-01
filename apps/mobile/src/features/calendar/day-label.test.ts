import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CITY_CLEARED } from "@babun/shared/local/day-cities";
import { resolveCalendarDayLabel, type DayLabelCity } from "./day-label";

const TEAM = "team-1";
// 2026-08-31 — понедельник, 2026-09-01 — вторник.
const TODAY = "2026-08-31";
const GREY = "#8E8E93";

const city = (over: Partial<DayLabelCity> = {}): DayLabelCity => ({
  name: "Лимассол",
  color: "#32ADE6",
  weekdays: [],
  is_active: true,
  deleted_at: null,
  tint_day: true,
  ...over,
});

const call = (over: Partial<Parameters<typeof resolveCalendarDayLabel>[0]>) =>
  resolveCalendarDayLabel({
    dayCities: {},
    cities: [],
    teamId: TEAM,
    dateYmd: TODAY,
    todayYmd: TODAY,
    fallbackColor: GREY,
    ...over,
  });

describe("метка дня календаря", () => {
  test("без команды метки нет — спрашивать не у кого", () => {
    assert.equal(call({ teamId: null }), null);
  });

  test("пустой день — метки нет", () => {
    assert.equal(call({ cities: [city({ weekdays: [3] })] }), null);
  });

  test("явная метка дня побеждает и цвет берёт из справочника", () => {
    const got = call({
      dayCities: { [`${TEAM}:${TODAY}`]: "Лимассол" },
      cities: [city()],
    });
    assert.deepEqual(got, { name: "Лимассол", color: "#32ADE6", tint: true });
  });

  test("РУКА ПОБЕЖДАЕТ РАСПИСАНИЕ: на дне стоит своё, чужое расписание молчит", () => {
    // Понедельник расписан за «Пафосом», но диспетчер поставил «Лимассол».
    const got = call({
      dayCities: { [`${TEAM}:${TODAY}`]: "Лимассол" },
      cities: [city(), city({ name: "Пафос", color: "#A63C00", weekdays: [1] })],
    });
    assert.equal(got?.name, "Лимассол");
  });

  test("СНЯТУЮ РУКОЙ МЕТКУ РАСПИСАНИЕ НЕ ВОСКРЕШАЕТ", () => {
    // Сентинел значит «здесь метки нет» — иначе снятие было бы невозможно:
    // расписание возвращало бы её на каждом рендере.
    const got = call({
      dayCities: { [`${TEAM}:${TODAY}`]: CITY_CLEARED },
      cities: [city({ weekdays: [1] })],
    });
    assert.equal(got, null);
  });

  test("расписание ставит метку на сегодня и вперёд", () => {
    const got = call({ cities: [city({ weekdays: [1] })] });
    assert.equal(got?.name, "Лимассол");
    const tomorrow = call({
      dateYmd: "2026-09-07",
      cities: [city({ weekdays: [1] })],
    });
    assert.equal(tomorrow?.name, "Лимассол");
  });

  test("ПРОШЛОЕ НЕ ПЕРЕПИСЫВАЕТСЯ НАСТРОЙКОЙ", () => {
    // Закон канона 2026-08-29. Прошлый понедельник расписанием не красится:
    // вычисляемое значение иначе следовало бы за текущей настройкой и
    // перекрашивало историю на каждой правке графика.
    const got = call({
      dateYmd: "2026-08-24",
      cities: [city({ weekdays: [1] })],
    });
    assert.equal(got, null);
  });

  test("скрытая и удалённая метки расписанием не ставятся", () => {
    assert.equal(call({ cities: [city({ weekdays: [1], is_active: false })] }), null);
    assert.equal(
      call({ cities: [city({ weekdays: [1], deleted_at: "2026-08-30" })] }),
      null,
    );
  });

  test("метки уже нет в справочнике — имя остаётся, цвет запасной", () => {
    // Метку стёрли, а на дне она стоит рукой. Прошлое не переписывается:
    // имя это правда о том дне, красить его просто нечем.
    const got = call({ dayCities: { [`${TEAM}:${TODAY}`]: "Стёртая" } });
    assert.deepEqual(got, { name: "Стёртая", color: GREY, tint: true });
  });

  test("tint_day = false доезжает как есть", () => {
    const got = call({
      dayCities: { [`${TEAM}:${TODAY}`]: "Лимассол" },
      cities: [city({ tint_day: false })],
    });
    assert.equal(got?.tint, false);
  });

  test("метка чужой команды на тот же день не подхватывается", () => {
    const got = call({ dayCities: { [`team-2:${TODAY}`]: "Лимассол" } });
    assert.equal(got, null);
  });
});
