import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { clientSmsVars, nextScheduledWork } from "./client-sms-vars";

type Apt = Parameters<typeof nextScheduledWork>[0][number];

const apt = (over: Partial<Apt>): Apt => ({
  date: "2026-09-25",
  time_start: "10:00",
  status: "scheduled",
  kind: "work",
  team_id: "t1",
  address: "Лимассол, Arch. Makariou 5",
  services: [{ serviceId: "s1", serviceName: "Чистка" } as Apt["services"][number]],
  total_amount: 60,
  ...over,
});

describe("ближайшая запись клиента", () => {
  test("берётся самая ранняя запланированная работа с сегодняшнего дня", () => {
    const list = [
      apt({ date: "2026-09-20" }),
      apt({ date: "2026-09-26", time_start: "09:00" }),
      apt({ date: "2026-09-25", time_start: "15:00" }),
      apt({ date: "2026-09-25", time_start: "11:00", status: "cancelled" }),
      apt({ date: "2026-09-25", time_start: "08:00", kind: "event" }),
    ];
    assert.equal(nextScheduledWork(list, "2026-09-24")?.time_start, "15:00");
  });

  test("сегодняшняя запись — ещё ближайшая", () => {
    assert.equal(nextScheduledWork([apt({ date: "2026-09-24" })], "2026-09-24")?.date, "2026-09-24");
  });
});

describe("поля шаблона из карточки", () => {
  const base = {
    client: { full_name: "Мария Петрова (вилла)", sms_name: "" },
    teams: [{ id: "t1", name: "Бригада 1" }],
    company: "Giliuta",
    today: "2026-09-24",
  };

  test("имя, компания и ближайшая запись", () => {
    const vars = clientSmsVars({ ...base, appointments: [apt({})], debt: 0, showMoney: true });
    assert.equal(vars.Name, "Мария");
    assert.equal(vars.Date, "25 сентября");
    assert.equal(vars.Master, "Бригада 1");
    assert.equal(vars.Service, "Чистка");
    assert.ok(vars.Price?.includes("60"));
    assert.equal(vars.Amount, undefined, "нулевой долг — не долг");
  });

  test("без денег клиента — ни цены, ни долга", () => {
    const vars = clientSmsVars({ ...base, appointments: [apt({})], debt: null, showMoney: false });
    assert.equal(vars.Price, undefined);
    assert.equal(vars.Amount, undefined);
  });

  test("без будущих записей — нет полей записи, есть имя и долг", () => {
    const vars = clientSmsVars({ ...base, appointments: [], debt: 120, showMoney: true });
    assert.equal(vars.Date, undefined);
    assert.equal(vars.Time, undefined);
    assert.ok(vars.Amount?.includes("120"));
  });
});
