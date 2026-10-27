import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Appointment } from "@babun/shared/local/appointments";
import { dayRouteAddresses, dayRouteTeamId, dayRouteUrl, dayRouteUrlFor } from "./day-route";

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

  test("the team's map opens the day: all stops where the map takes them", () => {
    const stops = ["Limassol 1", "Larnaca/3"];
    assert.equal(dayRouteUrlFor("google", stops), dayRouteUrl(stops));
    assert.equal(
      dayRouteUrlFor("yandex", stops),
      "https://yandex.ru/maps/?rtext=~Limassol%201~Larnaca%2F3&rtt=auto",
    );
    // Apple и Waze ведут к одной точке — к первому выезду.
    assert.equal(dayRouteUrlFor("apple", stops), "https://maps.apple.com/?q=Limassol%201");
    assert.equal(dayRouteUrlFor("waze", stops), "https://waze.com/ul?q=Limassol%201&navigate=yes");
    assert.equal(dayRouteUrlFor("apple", []), null);
  });

  test("the day's maps are the first field visit's team", () => {
    assert.equal(
      dayRouteTeamId([
        apt({ id: "1", kind: "event", team_id: "ev" }),
        apt({ id: "2", status: "cancelled", team_id: "off" }),
        apt({ id: "3", team_id: "crew" }),
      ]),
      "crew",
    );
    assert.equal(dayRouteTeamId([apt({ id: "1" })]), null);
  });
});
