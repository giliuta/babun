import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { referenceGate, type GateQuery, type ReferenceGateInput } from "./reference-gate";

const q = (over: Partial<GateQuery> = {}): GateQuery => ({
  isPending: false,
  isLoadingError: false,
  isFetching: false,
  error: null,
  refetch: () => Promise.resolve(),
  ...over,
});

const input = (over: Partial<ReferenceGateInput> = {}): ReferenceGateInput => ({
  kind: "work",
  isEdit: false,
  teamId: "t1",
  teamsQuery: q(),
  mastersQuery: q(),
  servicesQuery: q(),
  clientsQuery: q(),
  appointmentsQuery: q(),
  calendarSettingsQuery: q(),
  eventTypesQuery: q(),
  teamScheduleQuery: q(),
  ...over,
});

const labels = (refs: readonly { label: string }[]) => refs.map((r) => r.label);

describe("referenceGate", () => {
  test("a record waits for teams and clients; an edit also for the record list", () => {
    assert.deepEqual(labels(referenceGate(input()).essentialQueries), ["команды", "клиентов"]);
    assert.deepEqual(
      labels(referenceGate(input({ isEdit: true })).essentialQueries),
      ["команды", "клиентов", "запись"],
    );
  });

  test("an event waits for teams only (plus the list when editing)", () => {
    assert.deepEqual(labels(referenceGate(input({ kind: "event" })).essentialQueries), ["команды"]);
    assert.deepEqual(
      labels(referenceGate(input({ kind: "event", isEdit: true })).essentialQueries),
      ["команды", "запись"],
    );
  });

  test("the team schedule is a reference only once a team is chosen", () => {
    assert.ok(labels(referenceGate(input()).referenceQueries).includes("график команды"));
    assert.ok(!labels(referenceGate(input({ teamId: null })).referenceQueries).includes("график команды"));
    assert.deepEqual(labels(referenceGate(input({ kind: "event" })).referenceQueries), [
      "команды",
      "календарь",
      "настройки календаря",
      "типы событий",
    ]);
  });

  test("only a failed FIRST load of an essential reference hides the form", () => {
    const failed = referenceGate(input({ clientsQuery: q({ isLoadingError: true }) }));
    assert.equal(failed.failedReference?.label, "клиентов");
    const optional = referenceGate(input({ servicesQuery: q({ isLoadingError: true }) }));
    assert.equal(optional.failedReference, undefined);
  });

  test("pending while any essential reference has no data yet", () => {
    assert.equal(referenceGate(input({ teamsQuery: q({ isPending: true }) })).referencesPending, true);
    assert.equal(referenceGate(input({ servicesQuery: q({ isPending: true }) })).referencesPending, false);
  });
});
