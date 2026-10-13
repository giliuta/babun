import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Appointment } from "@babun/shared/local/appointments";
import { dayRouteAddresses, dayRouteUrl } from "./day-route";

const apt = (over: Partial<Appointment>): Appointment =>
  ({ id: "x", kind: "work", status: "scheduled", ...over }) as Appointment;

describe("day route", () => {
  test("only field visits, in visit order, without repeats", () => {
    const data = [
      apt({ id: "1", address: " Limassol 1 " }),
      apt({ id: "2", address: "Paphos 2", status: "cancelled" }),
      apt({ id: "3", address: "Event street", kind: "event" }),
      apt({ id: "4", address: "Limassol 1" }),
      apt({ id: "5", address: "" }),
      apt({ id: "6", address: "Larnaca 3" }),
    ];
    assert.deepEqual(dayRouteAddresses(data), ["Limassol 1", "Larnaca 3"]);
  });

  test("the grid's address rule wins over the record snapshot", () => {
    const data = [apt({ id: "1" }), apt({ id: "2", address: "Snapshot" })];
    const addressFor = (a: Appointment) => (a.id === "1" ? "Client home" : null);
    assert.deepEqual(dayRouteAddresses(data, addressFor), ["Client home", "Snapshot"]);
  });

  test("maps link: encoded waypoints, none without addresses", () => {
    assert.equal(dayRouteUrl([]), null);
    assert.equal(
      dayRouteUrl(["Limassol 1", "Larnaca/3"]),
      "https://www.google.com/maps/dir/Limassol%201/Larnaca%2F3",
    );
  });
});
