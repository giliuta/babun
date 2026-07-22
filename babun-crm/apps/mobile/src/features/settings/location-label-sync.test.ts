import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { LocationLabel } from "@babun/shared/local/location-labels";
import {
  locationLabelRemoveIds,
  locationLabelUpserts,
  positionedLocationLabelUpserts,
} from "./location-label-sync";

const label = (id: string): LocationLabel => ({ id, name: id });

describe("location label explicit removals", () => {
  test("archives only a row removed from the user's visible snapshot", () => {
    assert.deepEqual(
      locationLabelRemoveIds(
        [label("home"), label("office")],
        [label("office")],
      ),
      ["home"],
    );
  });

  test("never removes a concurrent server row absent from the stale snapshot", () => {
    const previous = [label("home"), label("office")];
    const concurrentServerRow = label("villa");
    const removeIds = locationLabelRemoveIds(previous, [label("office")]);

    assert.equal(removeIds.includes(concurrentServerRow.id), false);
  });

  test("does not overwrite unchanged rows from a stale full snapshot", () => {
    const previous = [label("home"), label("office")];
    const added = label("villa");

    assert.deepEqual(locationLabelUpserts(previous, [...previous, added]), [added]);
  });

  test("keeps appended and renamed rows at their deterministic list positions", () => {
    const previous = [
      { id: "home", name: "Дом" },
      { id: "office", name: "Офис" },
    ];
    assert.deepEqual(
      positionedLocationLabelUpserts(previous, [
        ...previous,
        { id: "villa", name: "Вилла" },
      ]),
      [{ id: "villa", name: "Вилла", position: 2 }],
    );
    assert.deepEqual(
      positionedLocationLabelUpserts(previous, [
        previous[0]!,
        { id: "office", name: "Рабочий офис" },
      ]),
      [{ id: "office", name: "Рабочий офис", position: 1 }],
    );
  });
});
