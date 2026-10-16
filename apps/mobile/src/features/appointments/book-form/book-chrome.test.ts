import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { bookChrome, bookTitle, type BookChromeInput } from "./book-chrome";

describe("bookTitle", () => {
  test("new record, saved record, event", () => {
    assert.equal(bookTitle(false, "work"), "Новая запись");
    assert.equal(bookTitle(true, "work"), "Запись");
    assert.equal(bookTitle(false, "event"), "Событие");
    assert.equal(bookTitle(true, "event"), "Событие");
  });
});

const input = (over: Partial<BookChromeInput> = {}): BookChromeInput => ({
  kind: "event",
  eventColor: null,
  colorOverride: null,
  autoColorRule: "team",
  teamColor: "#2c5be0",
  labelColor: null,
  serviceIds: [],
  serviceColorById: new Map(),
  editing: null,
  date: "2026-10-05",
  clientId: null,
  locationId: null,
  address: "",
  customTotal: false,
  effectiveTotal: 0,
  todayYmd: "2026-10-05",
  situationPalette: {},
  activeSituations: [],
  fallbackColor: "#3355ff",
  accent: "#0000ff",
  canvas: "#ffffff",
  ...over,
});

describe("bookChrome", () => {
  test("an event is painted by the hand-picked colour, else the team's", () => {
    const picked = bookChrome(input({ eventColor: "#ff8800" }));
    assert.equal(picked.hasColor, true);
    assert.equal(picked.identityC, "#ff8800");
    assert.equal(picked.identityAuto, "#2c5be0");
    const auto = bookChrome(input());
    assert.equal(auto.hasColor, false);
    assert.equal(auto.identityC, "#2c5be0");
  });

  test("with no team colour either, the theme accent", () => {
    assert.equal(bookChrome(input({ teamColor: null })).identityC, "#0000ff");
  });

  test("a record's hand-picked colour wins; the page ground stays the canvas", () => {
    const out = bookChrome(input({ kind: "work", colorOverride: "#00aa00" }));
    assert.equal(out.identityC, "#00aa00");
    assert.equal(out.groundBg, "#ffffff");
    assert.notEqual(out.headerBg, "#ffffff");
  });
});
