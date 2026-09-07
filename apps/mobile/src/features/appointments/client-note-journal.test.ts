import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { applyNoteEdit } from "./client-note-journal";

const fresh = () => ({ id: "new", created_at: "2026-09-04T10:00:00.000Z" });
const journal = [
  { id: "h1", text: "звонить после 18", created_at: "2026-09-03T00:00:00.000Z" },
  { id: "h2", text: "собака во дворе", created_at: "2026-09-01T00:00:00.000Z" },
];

describe("applyNoteEdit", () => {
  test("edits the bound note in place", () => {
    const { notes, createdId } = applyNoteEdit(journal, "звонить после 19", "h1", fresh);
    assert.deepEqual(notes.map((n) => n.text), ["звонить после 19", "собака во дворе"]);
    assert.equal(createdId, null);
  });

  test("clearing removes only the bound note, and a second clear is a no-op", () => {
    const once = applyNoteEdit(journal, "", "h1", fresh).notes;
    assert.deepEqual(once.map((n) => n.id), ["h2"]);
    const twice = applyNoteEdit(once, "", "h1", fresh).notes;
    assert.deepEqual(twice.map((n) => n.id), ["h2"]);
  });

  test("typing after a clear creates a new note instead of rewriting the neighbour", () => {
    const cleared = applyNoteEdit(journal, "", "h1", fresh).notes;
    const { notes, createdId } = applyNoteEdit(cleared, "ключ у соседей", "h1", fresh);
    assert.equal(createdId, "new");
    assert.deepEqual(notes.map((n) => n.id), ["new", "h2"]);
  });

  test("an empty journal gets its first note", () => {
    const { notes, createdId } = applyNoteEdit([], "код ворот 1234", null, fresh);
    assert.equal(createdId, "new");
    assert.equal(notes.length, 1);
  });

  test("clearing an empty journal changes nothing", () => {
    assert.deepEqual(applyNoteEdit([], "", null, fresh).notes, []);
  });
});
