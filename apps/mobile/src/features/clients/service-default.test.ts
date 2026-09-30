import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { withServiceDefault } from "./service-default";

const loc = (id: string, serviceEveryMonths?: number) => ({
  id,
  label: id,
  address: "",
  isPrimary: false,
  ...(serviceEveryMonths ? { serviceEveryMonths } : {}),
});

describe("интервал обслуживания команды", () => {
  const monthsOf = (teamId: string | null | undefined) => (teamId === "t1" ? 6 : null);

  test("объект без своего интервала берёт интервал команды клиента", () => {
    const [c] = withServiceDefault(
      [{ id: "a", team_id: "t1", locations: [loc("l1"), loc("l2", 3)] }],
      monthsOf,
    );
    assert.deepEqual(
      c?.locations?.map((l) => l.serviceEveryMonths),
      [6, 3],
    );
  });

  test("у команды без интервала клиенты не трогаются", () => {
    const clients = [{ id: "a", team_id: "t3", locations: [loc("l1")] }];
    assert.equal(withServiceDefault(clients, monthsOf), clients);
  });

  test("исходные клиенты не меняются — умолчание только в копии", () => {
    const clients = [{ id: "a", team_id: "t1", locations: [loc("l1")] }];
    withServiceDefault(clients, monthsOf);
    assert.equal(clients[0]?.locations[0]?.serviceEveryMonths, undefined);
  });
});
