import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Appointment } from "@babun/shared/local/appointments";
import type { Location } from "@babun/shared/local/clients";
import { addMonthsYmd, servicePlan } from "./service-plan";

// Регулярность — обещание клиенту («приедем через месяц»). Ошибка здесь либо
// зовёт команду впустую, либо молчит, когда клиент уже ждёт.

const TODAY = "2026-08-07";

const loc = (over: Partial<Location> = {}): Location => ({
  id: "l1",
  label: "Вилла",
  address: "Ленина 1",
  isPrimary: true,
  ...over,
});

const visit = (date: string, over: Partial<Appointment> = {}): Appointment =>
  ({
    id: `a-${date}`,
    date,
    location_id: "l1",
    status: "completed",
    kind: "work",
    ...over,
  }) as Appointment;

describe("регулярное обслуживание объекта", () => {
  test("без интервала плана нет", () => {
    assert.equal(servicePlan(loc(), [visit("2026-07-01")], TODAY), null);
  });

  test("без визитов отсчёт не начат", () => {
    assert.equal(servicePlan(loc({ serviceEveryMonths: 1 }), [], TODAY), null);
  });

  test("срок считается от последнего визита", () => {
    const plan = servicePlan(
      loc({ serviceEveryMonths: 3 }),
      [visit("2026-01-10"), visit("2026-06-10")],
      TODAY,
    );
    assert.equal(plan?.dueYmd, "2026-09-10");
    assert.equal(plan?.due, false);
  });

  test("просроченное обслуживание зовёт вернуться", () => {
    const plan = servicePlan(
      loc({ serviceEveryMonths: 1 }),
      [visit("2026-05-01")],
      TODAY,
    );
    assert.equal(plan?.due, true);
    assert.equal(plan?.text, "Пора обслужить");
  });

  test("близкий срок печатается днями", () => {
    const plan = servicePlan(
      loc({ serviceEveryMonths: 1 }),
      [visit("2026-07-15")],
      TODAY,
    );
    assert.equal(plan?.daysLeft, 8);
    assert.equal(plan?.text, "Обслужить через 8 дней");
  });

  test("отменённый визит не считается обслуживанием", () => {
    const plan = servicePlan(
      loc({ serviceEveryMonths: 1 }),
      [visit("2026-08-01", { status: "cancelled" }), visit("2026-06-01")],
      TODAY,
    );
    assert.equal(plan?.dueYmd, "2026-07-01");
  });

  test("визит на ДРУГОЙ объект не сбрасывает срок", () => {
    const plan = servicePlan(
      loc({ serviceEveryMonths: 1 }),
      [visit("2026-08-01", { location_id: "l2" }), visit("2026-06-01")],
      TODAY,
    );
    assert.equal(plan?.dueYmd, "2026-07-01");
  });

  test("конец месяца не перескакивает через месяц", () => {
    assert.equal(addMonthsYmd("2026-01-31", 1), "2026-02-28");
    assert.equal(addMonthsYmd("2026-12-15", 1), "2027-01-15");
  });
});
